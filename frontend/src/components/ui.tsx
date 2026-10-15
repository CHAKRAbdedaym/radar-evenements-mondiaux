import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BaselineType, Lang } from "../api";
import { ApiError } from "../api";
import { fmtInt, fmtRelative, fmtSigned, fmtDateTimeUtc, fmtTimeUtc } from "../lib/format";
import { SLOW_FEED_PER_MIN } from "../lib/clock";
import { LANG_CODE, LANG_COLOR, LANG_NAME, LANGS, articlePath, dirOf } from "../lib/lang";
import { useFeedStatus, useNow, useReducedMotion } from "../hooks/usePolling";

export function Panel({ title, right, children, className = "", bodyClass = "p-4 sm:p-5" }: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`panel min-w-0 ${className}`}>
      {(title || right) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          {title && <h2 className="font-display text-[15px] font-semibold tracking-tight text-ink">{title}</h2>}
          {right}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function PageHeader({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6 fade-up">
      <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
        <span aria-hidden className="mr-2">{icon}</span>
        {title}
      </h1>
      {children && <div className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">{children}</div>}
    </header>
  );
}

/** Language badge: always the code as text + the language color as a dot. */
export function LangBadge({ lang, size = "sm" }: { lang: Lang; size?: "sm" | "md" }) {
  return (
    <span
      title={`Wikipédia en ${LANG_NAME[lang]}`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border font-mono font-bold ${
        size === "md" ? "px-2 py-1 text-xs" : "px-1.5 py-0.5 text-[10.5px]"
      }`}
      style={{ borderColor: `${LANG_COLOR[lang]}88`, background: `${LANG_COLOR[lang]}22`, color: "#E6EDF7" }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: LANG_COLOR[lang] }} aria-hidden />
      {LANG_CODE[lang]}
    </span>
  );
}

/** Text written in `lang`, bidi-isolated (<bdi>) so Arabic keeps its order inside French sentences. */
export function LangText({ lang, children, className = "" }: { lang: Lang; children: ReactNode; className?: string }) {
  return (
    <bdi dir={dirOf(lang)} lang={lang} className={`${lang === "ar" ? "font-arabic" : ""} ${className}`}>
      {children}
    </bdi>
  );
}

/** Article title linking to the internal article page, bidi-isolated for Arabic. */
export function ArticleLink({ lang, title, className = "" }: { lang: Lang; title: string; className?: string }) {
  return (
    <Link
      to={articlePath(lang, title)}
      className={`hover:text-cyan hover:underline decoration-cyan/40 underline-offset-2 ${className}`}
    >
      <LangText lang={lang}>{title}</LangText>
    </Link>
  );
}

export function DeltaBytes({ value, className = "" }: { value: number; className?: string }) {
  const cls = value > 0 ? "text-plus" : value < 0 ? "text-minus" : "text-ink-3";
  return (
    <span className={`num ${cls} ${className}`} title={`${fmtSigned(value)} octets`}>
      {fmtSigned(value)}
      <span className="ml-0.5 text-[10px] opacity-70">o</span>
    </span>
  );
}

export function TimeAgo({ iso, withUtc = true }: { iso: string | null | undefined; withUtc?: boolean }) {
  const now = useNow(5000);
  if (!iso) return <span className="text-ink-3">–</span>;
  return (
    <time dateTime={iso} title={fmtDateTimeUtc(iso)} className="whitespace-nowrap">
      {fmtRelative(iso, now)}
      {withUtc && <span className="sr-only"> ({fmtDateTimeUtc(iso)})</span>}
    </time>
  );
}

export function BaselineBadge({ type }: { type: BaselineType | null | undefined }) {
  if (!type) return null;
  const prov = type === "provisoire";
  const tip = prov
    ? "Base provisoire : cet article n'a pas encore 6 h d'historique dans notre base. On le compare à l'activité habituelle de tous les articles."
    : "Base article : l'activité est comparée à l'historique propre de cet article (jusqu'à 24 h).";
  return (
    <InfoTip tip={tip}>
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wide ${
          prov ? "border-yellow-300/40 bg-yellow-300/10 text-yellow-100" : "border-cyan/40 bg-cyan/10 text-cyan"
        }`}
      >
        base {type}
        <span aria-hidden className="opacity-70">ⓘ</span>
      </span>
    </InfoTip>
  );
}

/** Hover / focus tooltip with plain text. */
export function InfoTip({ tip, children, align = "center", below = false }: { tip: string; children: ReactNode; align?: "center" | "right" | "left"; below?: boolean }) {
  const pos = align === "right" ? "right-0" : align === "left" ? "left-0" : "left-1/2 -translate-x-1/2";
  return (
    <span className="group relative inline-flex" tabIndex={0} aria-label={tip}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute ${below ? "top-full mt-2" : "bottom-full mb-2"} ${pos} z-30 w-64 max-w-[80vw] rounded-lg border border-line2 bg-[#0d1528] p-2.5 text-xs leading-snug text-ink-2 opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100`}
      >
        {tip}
      </span>
    </span>
  );
}

/* ---------- states ---------- */

export function Loading({ label = "Chargement…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2.5 py-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-4" style={{ width: `${92 - i * 14}%` }} />
      ))}
      <p className="pt-1 font-mono text-xs text-ink-3">{label}</p>
    </div>
  );
}

export function Empty({ title = "En attente de données…", children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="relative h-10 w-10" aria-hidden>
        <span className="absolute inset-0 rounded-full border border-cyan/30" />
        <span className="absolute inset-2.5 rounded-full border border-cyan/40" />
        <span className="live-dot absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan" />
      </div>
      <p className="font-display text-[15px] font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const status = error instanceof ApiError ? error.status : 0;
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-8 text-center">
      <p className="font-display text-[15px] font-medium text-alert">⚠ Impossible de charger les données</p>
      <p className="max-w-md text-sm text-ink-3">
        {error.message}
        {status ? <span className="num"> (HTTP {status})</span> : null}
      </p>
      {onRetry && (
        <button className="btn mt-1" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

/** Small banner shown when a refresh fails but older data is still displayed. */
export function StaleBanner({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="status" className="mb-3 rounded-lg border border-alert/40 bg-alert-soft px-3 py-2 text-xs text-orange-100">
      ⚠ Dernière mise à jour impossible ({error.message}). Nouvel essai automatique…
    </p>
  );
}

/** Generic wrapper for a polled view: handles loading / error / empty consistently. */
export function DataView<T>({ state, isEmpty, empty, children, loadingRows }: {
  state: { data: T | null; error: Error | null; loading: boolean; refresh: () => void };
  isEmpty?: (d: T) => boolean;
  empty?: ReactNode;
  loadingRows?: number;
  children: (d: T) => ReactNode;
}) {
  const { data, error, loading, refresh } = state;
  if (data === null) {
    if (error) return <ErrorState error={error} onRetry={refresh} />;
    if (loading) return <Loading rows={loadingRows} />;
    return <Empty />;
  }
  if (isEmpty && isEmpty(data)) return <>{empty ?? <Empty />}</>;
  return (
    <>
      <StaleBanner error={error} />
      {children(data)}
    </>
  );
}

/* ---------- controls ---------- */

export function LangFilter({ value, onChange }: { value: Lang | null; onChange: (l: Lang | null) => void }) {
  const opts: { v: Lang | null; label: string }[] = [{ v: null, label: "Toutes" }, ...LANGS.map((l) => ({ v: l, label: LANG_CODE[l] }))];
  return (
    <div role="radiogroup" aria-label="Langue" className="inline-flex rounded-lg border border-line2 bg-night/60 p-0.5">
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.label}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.v)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
              active ? "bg-cyan/15 text-cyan shadow-[inset_0_0_0_1px_rgba(63,208,201,0.45)]" : "text-ink-2 hover:text-white"
            }`}
          >
            {o.v && <span className="h-2 w-2 rounded-full" style={{ background: LANG_COLOR[o.v] }} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-ink-2">
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full border transition-colors ${checked ? "border-cyan/60 bg-cyan/30" : "border-line2 bg-night"}`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${checked ? "left-[18px] bg-cyan" : "left-0.5 bg-ink-3"}`}
        />
      </button>
      <span onClick={() => onChange(!checked)}>{label}</span>
    </label>
  );
}

/* ---------- numbers ---------- */

/** Number that tweens to its new value (requestAnimationFrame, off with reduced motion). */
export function AnimatedNumber({ value, format = fmtInt }: { value: number; format?: (n: number) => string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = from + (value - from) * e;
      setShown(v);
      fromRef.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <>{format(Math.round(shown))}</>;
}

export function StatTile({ label, value, hint, accent = "cyan", children }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: "cyan" | "alert" | "none";
  children?: ReactNode;
}) {
  const bar = accent === "alert" ? "bg-alert" : accent === "cyan" ? "bg-cyan" : "bg-line2";
  return (
    <div className="panel relative overflow-hidden px-4 py-3">
      <span className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r ${bar}`} aria-hidden />
      <p className="label">{label}</p>
      <p className={`num mt-1 text-2xl font-bold leading-tight sm:text-[26px] ${accent === "alert" ? "text-alert" : "text-white"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      {children}
    </div>
  );
}

export function LiveIndicator({ lastUpdated, error, feed = true }: { lastUpdated: number | null; error: Error | null; feed?: boolean }) {
  useNow(1000); // re-render every second
  const now = Date.now(); // lastUpdated is a browser timestamp: compare with the browser clock
  const ok = !error && lastUpdated !== null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px] text-ink-3" aria-live="off">
      <span className="inline-flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${ok ? "live-dot bg-cyan" : "bg-alert"}`} aria-hidden />
        {ok ? <>EN DIRECT · maj {fmtRelative(lastUpdated!, now)}</> : error ? "connexion perdue" : "connexion…"}
      </span>
      {feed && <FeedBadge />}
    </span>
  );
}

/** Honest status of the live feed: reference time of the data + "Flux ralenti" when ingestion is slow. */
export function FeedBadge() {
  const f = useFeedStatus();
  if (!f.refTime) return null;
  const slow = f.ratePerMin !== null && f.ratePerMin < SLOW_FEED_PER_MIN;
  return (
    <>
      <span title="Heure de la modification la plus récente reçue (heure de l'événement Wikipédia)">
        Données jusqu'à <span className="text-ink-2">{fmtTimeUtc(f.refTime)}</span>
      </span>
      {slow && (
        <InfoTip
          align="right"
          below
          tip={`Le serveur reçoit actuellement ${fmtInt(f.ratePerMin ?? 0)} modifs/min ; les chiffres affichés correspondent à l'activité Wikipédia jusqu'à ${fmtTimeUtc(f.refTime)}.`}
        >
          <span className="cursor-help rounded-md border border-alert/50 bg-alert-soft px-1.5 py-0.5 font-bold text-alert">
            ⚠ Connexion lente : flux en retard
          </span>
        </InfoTip>
      )}
    </>
  );
}

/** Legend of the three languages: color + code + name. */
export function LangLegend({ className = "" }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2 ${className}`}>
      {LANGS.map((l) => (
        <li key={l} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: LANG_COLOR[l] }} aria-hidden />
          <span className="font-mono font-bold text-ink">{LANG_CODE[l]}</span> {LANG_NAME[l]}
        </li>
      ))}
    </ul>
  );
}
