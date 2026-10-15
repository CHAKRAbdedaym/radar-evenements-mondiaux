import { useMemo, useState } from "react";
import { api, type Alert, type Lang } from "../api";
import { usePolling } from "../hooks/usePolling";
import { fmtDateTimeUtc, fmtDec1, fmtDec2, fmtInt, fmtTime } from "../lib/format";
import { LANG_NAME } from "../lib/lang";
import { ArticleLink, BaselineBadge, DataView, DeltaBytes, Empty, LangBadge, LangFilter, LiveIndicator, PageHeader, TimeAgo } from "../components/ui";

/** One card per article: the strongest alert in front, every detected window listed below. */
function AlertCard({ group }: { group: Alert[] }) {
  const a = group[0];
  return (
    <article className="panel fade-up relative overflow-hidden p-4 sm:p-5">
      <span className="absolute inset-y-0 left-0 w-1 bg-alert" aria-hidden />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <LangBadge lang={a.lang} size="md" />
            <BaselineBadge type={a.baseline_type} />
          </div>
          <h2 className="mt-2 font-display text-lg font-semibold leading-snug text-white">
            <ArticleLink lang={a.lang} title={a.title} />
          </h2>
          <p className="mt-1 text-xs text-ink-3">Wikipédia en {LANG_NAME[a.lang]}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="label">z-score</p>
          <p className="num text-4xl font-bold leading-none text-alert">{fmtDec1(a.z_score)}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="label">Modifications</dt>
          <dd className="num mt-0.5 text-lg font-semibold text-white">{fmtInt(a.edits)}</dd>
        </div>
        <div>
          <dt className="label">Contributeurs</dt>
          <dd className="num mt-0.5 text-lg font-semibold text-white">{fmtInt(a.distinct_users)}</dd>
        </div>
        <div>
          <dt className="label">Octets</dt>
          <dd className="mt-0.5 text-lg font-semibold">
            <DeltaBytes value={a.delta_bytes} />
          </dd>
        </div>
        <div>
          <dt className="label">Normale</dt>
          <dd className="num mt-0.5 text-sm text-ink-2" title="moyenne et écart-type des modifications par tranche de 5 min">
            {fmtDec2(a.baseline_mean)} ± {fmtDec2(a.baseline_std)}
          </dd>
        </div>
      </dl>
      {group.length === 1 ? (
        <p className="mt-4 border-t border-line pt-3 font-mono text-xs text-ink-3">
          Fenêtre {fmtTime(a.window_start)} → {fmtTime(a.window_end)} UTC · {fmtDateTimeUtc(a.window_end).slice(0, 10)} · détectée{" "}
          <TimeAgo iso={a.window_end} />
        </p>
      ) : (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-xs font-semibold text-ink-2">
            {fmtInt(group.length)} alertes pour cet article (pics distincts) :
          </p>
          <ul className="mt-1.5 space-y-1">
            {[...group]
              .sort((x, y) => y.window_end.localeCompare(x.window_end))
              .map((g) => (
                <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-xs text-ink-3">
                  <span>
                    {fmtTime(g.window_start)} → {fmtTime(g.window_end)} UTC · détectée <TimeAgo iso={g.window_end} />
                  </span>
                  <span className={`num font-bold ${g.id === a.id ? "text-alert" : "text-ink-2"}`}>z {fmtDec1(g.z_score)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export default function AlertsPage() {
  const [lang, setLang] = useState<Lang | null>(null);
  const alerts = usePolling((s) => api.alerts({ lang, limit: 100 }, s), 15000, [lang]);
  // Group by article (no dedup: every alert returned by the API is listed), strongest first.
  const groups = useMemo(() => {
    const m = new Map<string, Alert[]>();
    for (const a of alerts.data?.items ?? []) {
      const k = `${a.lang}:${a.title}`;
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.values()]
      .map((g) => [...g].sort((x, y) => y.z_score - x.z_score))
      .sort((x, y) => y[0].z_score - x[0].z_score);
  }, [alerts.data]);
  const total = alerts.data?.items.length ?? 0;

  return (
    <div>
      <PageHeader icon="🚨" title="Alertes">
        <p>
          Le <strong className="text-ink">z-score</strong> mesure combien de fois l'activité actuelle dépasse l'activité habituelle de l'article :{" "}
          <span className="num text-ink">z = 3</span> signifie 3 écarts-types au-dessus de la normale.
        </p>
        <p className="mt-2 text-sm text-ink-3">
          Une alerte est créée quand z &gt; 3 avec au moins 3 contributeurs différents en 5 minutes (hors bots). Ce détecteur Python est
          provisoire : <strong className="text-ink-2">Spark le remplacera</strong> dans la prochaine phase du projet.
        </p>
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="label">Langue</span>
          <LangFilter value={lang} onChange={setLang} />
        </div>
        <LiveIndicator lastUpdated={alerts.lastUpdated} error={alerts.error} />
      </div>

      <DataView
        state={alerts}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <div className="panel">
            <Empty>
              Aucune alerte pour l'instant. Le détecteur analyse les 5 dernières minutes toutes les 60 s ; une alerte apparaîtra ici dès
              qu'un article s'emballe.
            </Empty>
          </div>
        }
      >
        {() => (
          <>
            <p className="mb-3 text-sm text-ink-3">
              {fmtInt(total)} alerte{total > 1 ? "s" : ""} · {fmtInt(groups.length)} article{groups.length > 1 ? "s" : ""} · triés par
              z-score maximal
            </p>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {groups.map((g) => (
                <AlertCard key={`${g[0].lang}:${g[0].title}`} group={g} />
              ))}
            </div>
          </>
        )}
      </DataView>
    </div>
  );
}
