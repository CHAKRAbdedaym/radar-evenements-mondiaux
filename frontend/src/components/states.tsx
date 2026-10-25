import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../api";
import { fmtTimeUtc } from "../lib/format";

/** One sentence, 14px ink-2, optional second line with the reason. No icon. */
export function EmptyState({ children, reason }: { children: ReactNode; reason?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {reason && <p>{reason}</p>}
    </div>
  );
}

/** Static hairline skeleton at the final layout size (no shimmer). */
export function Loading({ lines = 3, height = 14, label = "Chargement" }: { lines?: number; height?: number; label?: string }) {
  const widths = ["92%", "78%", "86%", "64%", "88%", "72%", "80%", "60%"];
  return (
    <div role="status" aria-live="polite" style={{ padding: "8px 0" }}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className="skel" style={{ height, width: widths[i % widths.length] }} />
      ))}
    </div>
  );
}

/** A grey block of the exact chart height while it loads. */
export function ChartSkeleton({ height }: { height: number }) {
  return <span className="skel" style={{ height, width: "100%" }} aria-hidden="true" />;
}

function errorText(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "Impossible de charger les données (API indisponible).";
    if (error.status === 404) return "Ces données n’existent pas encore dans l’API.";
    return `Impossible de charger les données (erreur ${error.status}).`;
  }
  return "Impossible de charger les données.";
}

/** "Impossible de charger les données (API indisponible). Nouvel essai dans 10 s. Réessayer" */
export function ErrorState({ error, onRetry, retryMs }: { error: Error; onRetry?: () => void; retryMs?: number | null }) {
  const [left, setLeft] = useState(retryMs ? Math.round(retryMs / 1000) : 0);
  useEffect(() => {
    if (!retryMs) return;
    setLeft(Math.round(retryMs / 1000));
    const id = window.setInterval(() => setLeft((s) => (s > 1 ? s - 1 : Math.round(retryMs / 1000))), 1000);
    return () => window.clearInterval(id);
  }, [retryMs, error]);
  return (
    <div className="error" role="alert">
      {errorText(error)}
      {retryMs ? ` Nouvel essai dans ${left} s.` : ""}
      {onRetry && (
        <button type="button" className="btn-text" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

/** Shown above data that is still displayed after a failed refresh. */
export function StaleNote({ error, lastUpdated }: { error: Error | null; lastUpdated: number | null }) {
  if (!error || !lastUpdated) return null;
  return <p className="source">Mise à jour impossible pour l’instant : affichage des données reçues à {fmtTimeUtc(lastUpdated)} (heure du navigateur).</p>;
}

/** Standard data block: loading → error → empty → content. */
export function Async<T>({
  state,
  children,
  empty,
  isEmpty,
  lines,
  skeleton,
  retryMs,
}: {
  state: { data: T | null; error: Error | null; loading: boolean; refresh: () => void };
  children: (data: T) => ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  lines?: number;
  skeleton?: ReactNode;
  retryMs?: number | null;
}) {
  if (state.data === null) {
    if (state.error) return <ErrorState error={state.error} onRetry={state.refresh} retryMs={retryMs} />;
    return <>{skeleton ?? <Loading lines={lines} />}</>;
  }
  if (isEmpty && isEmpty(state.data)) return <>{empty ?? <EmptyState>Aucune donnée pour l’instant.</EmptyState>}</>;
  return <>{children(state.data)}</>;
}
