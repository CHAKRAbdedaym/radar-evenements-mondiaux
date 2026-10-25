import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Edit, type Lang, type Timeline } from "../api";
import { useNow, usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtInt, fmtSigned, fmtTime, fmtTimeSec, fmtTimeUtc, fmtZ, plural } from "../lib/format";
import { LANG_CODE, LANG_ORDER } from "../lib/lang";
import { LANG_COLOR } from "../styles/chart";
import { AlertsTable } from "../components/AlertsTable";
import { Choice } from "../components/blocks";
import { ChartFrame, LineChart } from "../components/charts";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { ArticleLink, Coll, LangCode, SectionHeader, SourceNote, Timestamp } from "../components/text";

type LangFilter = "all" | Lang;

function MinuteChart({ tl }: { tl: Timeline }) {
  // x-axis starts at the first minute with data (no fake flat zero before ingestion started).
  const first = tl.items.findIndex((p) => p.total > 0);
  const items = first > 0 ? tl.items.slice(first) : tl.items;
  const xs = items.map((p) => new Date(p.t).getTime());
  const langs = LANG_ORDER.filter((l) => items.some((p) => p[l] > 0));
  const total = items.reduce((a, p) => a + p.total, 0);
  const small = langs.filter((l) => l !== "en" && Math.max(...items.map((p) => p[l])) < 10);
  return (
    <ChartFrame
      title={`Modifications par minute${first > 0 ? `, depuis ${fmtTimeUtc(xs[0])}` : ", 60 dernières minutes"}`}
      source={
        <SourceNote>
          Wikimedia EventStreams, collection <Coll name="edits" /> (MongoDB). {fmtInt(total)} modifications sur la période.
          {first > 0 ? ` Pas de données avant ${fmtTimeUtc(xs[0])}.` : ""}
          {small.length ? ` ${small.map((l) => LANG_CODE[l]).join(" et ")} : moins de 10 modifications par minute.` : ""} Dernier point en pointillé : minute en cours, incomplète.
        </SourceNote>
      }
    >
      {items.length ? (
        <LineChart
          xs={xs}
          series={langs.map((l) => ({ key: l, label: LANG_CODE[l], color: LANG_COLOR[l], values: items.map((p) => p[l]), strokeWidth: 1.75 }))}
          height={240}
          partialLast="minute en cours"
          xFormat={(t) => fmtTime(t)}
          tipTitle={(t) => `${fmtTimeUtc(t)}, 1 min`}
          unit="modifications"
          ariaLabel={`Modifications par minute par langue, ${fmtInt(total)} au total.`}
        />
      ) : (
        <EmptyState>Aucune modification sur les 60 dernières minutes.</EmptyState>
      )}
    </ChartFrame>
  );
}

function Feed({ lang, bots, quiet }: { lang: Lang | null; bots: boolean; quiet?: boolean }) {
  const st = usePolling((s) => api.recentEdits({ lang, includeBots: bots, limit: 20 }, s), 5000, [lang, bots]);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!st.data) return;
    const ids = st.data.items.map((e) => e.id);
    const first = seen.current.size === 0;
    const neu = new Set(first ? [] : ids.filter((id) => !seen.current.has(id)));
    ids.forEach((id) => seen.current.add(id));
    setFresh(neu);
  }, [st.data]);
  if (!st.data) return st.error && !quiet ? <ErrorState error={st.error} onRetry={st.refresh} retryMs={5000} /> : <Loading lines={12} />;
  if (!st.data.items.length) return <EmptyState>Aucune modification reçue pour ce filtre.</EmptyState>;
  return (
    <>
      <ul className="feed" aria-live="off">
        {st.data.items.map((e: Edit, i: number) => (
          <li key={e.id} className={`${fresh.has(e.id) ? "is-new" : ""} ${i >= 12 ? "m-extra" : ""}`}>
            <span className="feed-t">{fmtTimeSec(e.timestamp)}</span> <LangCode lang={e.lang} />{" "}
            <ArticleLink lang={e.lang} title={e.title} className="hl" />
            <div className="t-12 muted" style={{ marginTop: 2 }}>
              <bdi>{e.user}</bdi>
              {e.bot ? " (robot)" : ""} · <span className="num">{fmtSigned(e.delta_bytes)} octets</span>
              {e.type === "new" ? " · création" : ""}
            </div>
          </li>
        ))}
      </ul>
      <SourceNote>
        collection <Coll name="edits" />, actualisé toutes les 5 s.
      </SourceNote>
    </>
  );
}

export default function LivePage() {
  useTitle("En direct");
  const [lf, setLf] = useState<LangFilter>("all");
  const [hideBots, setHideBots] = useState(true);
  const lang = lf === "all" ? null : lf;
  const now = useNow(10000);
  const tl = usePolling((s) => api.timeline({ minutes: 60, lang, includeBots: !hideBots }, s), 10000, [lang, hideBots]);
  const radar = usePolling((s) => api.radar({ lang, includeBots: !hideBots }, s), 10000, [lang, hideBots]);
  const alerts = usePolling((s) => api.alerts({ lang, limit: 50 }, s), 30000, [lang]);
  const liveCut = now - 2 * 3600 * 1000;
  // API down and nothing received: one page-level error; the blocks keep their skeletons at final height.
  const pageDown = !!tl.error && !tl.data && !!radar.error && !radar.data;
  const [allActive, setAllActive] = useState(false);
  // Top 20 by z-score (unknown last), then modifications.
  const sortedActive = useMemo(
    () =>
      [...(radar.data?.items ?? [])].sort((a, b) => {
        const za = a.z_score ?? -Infinity;
        const zb = b.z_score ?? -Infinity;
        if (zb !== za) return zb - za;
        return b.edits - a.edits;
      }),
    [radar.data],
  );
  const scored = allActive ? sortedActive : sortedActive.slice(0, 20);
  // Alerts: newest window first, one row per (article, window).
  const alertRows = useMemo(() => {
    const seen = new Set<string>();
    return [...(alerts.data?.items ?? [])]
      .sort((a, b) => (a.window_end < b.window_end ? 1 : -1))
      .filter((a) => {
        const k = `${a.lang}:${a.title}:${a.window_end}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }, [alerts.data]);
  const activeAlerts = alertRows.filter((a) => new Date(a.window_end).getTime() >= liveCut).length;

  return (
    <div>
      <header className="page-head">
        <h1 className="t-40">En direct</h1>
        <p className="standfirst">Chaque modification de Wikipédia en arabe, français et anglais arrive ici quelques secondes après sa publication.</p>
        <div className="filters" style={{ marginTop: 16 }}>
          <Choice<LangFilter>
            label="Langue"
            value={lf}
            onChange={setLf}
            options={[
              { value: "all", label: "toutes" },
              ...LANG_ORDER.map((l) => ({ value: l as LangFilter, label: <span className="mono">{LANG_CODE[l]}</span> })),
            ]}
          />
          <label className="check">
            <input type="checkbox" checked={hideBots} onChange={(e) => setHideBots(e.target.checked)} />
            Masquer les robots
          </label>
        </div>
      </header>

      {pageDown && (
        <div style={{ marginBottom: 32 }}>
          <ErrorState error={tl.error!} onRetry={() => [tl, radar, alerts].forEach((p) => p.refresh())} retryMs={10000} />
        </div>
      )}
      <div className="vr">
        <div className="split-main">
          <div className="vr">
            <section aria-labelledby="l-chart">
              <SectionHeader id="l-chart" title="Le rythme des modifications" right="actualisé toutes les 10 s" />
              {!tl.data ? tl.error && !pageDown ? <ErrorState error={tl.error} onRetry={tl.refresh} retryMs={10000} /> : <Loading lines={1} height={280} /> : <MinuteChart tl={tl.data} />}
            </section>

            <section aria-labelledby="l-active">
              <SectionHeader id="l-active" title="Articles actifs, 5 dernières minutes" right={radar.data ? plural(radar.data.items.length, "article") : null} />
              {!radar.data ? (
                radar.error && !pageDown ? <ErrorState error={radar.error} onRetry={radar.refresh} retryMs={10000} /> : <Loading lines={10} />
              ) : !scored.length ? (
                <EmptyState>Aucun article modifié dans les 5 dernières minutes.</EmptyState>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="dt">
                      <thead>
                        <tr>
                          <th>Article</th>
                          <th className="hide-m">Langue</th>
                          <th className="r">Modifications</th>
                          <th className="r hide-m">Contributeurs</th>
                          <th className="r hide-m">Octets</th>
                          <th className="r">z-score</th>
                          <th className="hide-m">Thème</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scored.map((a, i) => (
                          <tr key={`${a.lang}:${a.title}`} className={`${a.alert ? "is-alert" : ""} ${i >= 10 && !allActive ? "m-extra" : ""}`}>
                            <td className="title-cell">
                              <span className="show-m">
                                <LangCode lang={a.lang} />{" "}
                              </span>
                              <ArticleLink lang={a.lang} title={a.title} />
                              {a.alert && <span className="accent t-12"> · alerte</span>}
                            </td>
                            <td className="hide-m">
                              <LangCode lang={a.lang} />
                            </td>
                            <td className="r">{fmtInt(a.edits)}</td>
                            <td className="r hide-m">{fmtInt(a.distinct_users)}</td>
                            <td className="r hide-m">{fmtSigned(a.delta_bytes)}</td>
                            <td className={`r ${a.alert ? "accent" : ""}`} title={a.baseline_type ? `base ${a.baseline_type}` : "historique insuffisant"}>
                              {a.z_score === null ? <span className="faint">–</span> : fmtZ(a.z_score)}
                            </td>
                            <td className="hide-m muted theme-cell">{a.theme_label ?? <span className="faint">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {sortedActive.length > 20 && (
                    <button type="button" className="btn-text" style={{ marginTop: 8 }} onClick={() => setAllActive((v) => !v)}>
                      {allActive ? "Afficher les 20 premiers" : `Afficher les ${fmtInt(sortedActive.length - 20)} autres`}
                    </button>
                  )}
                  <SourceNote>
                    collections <Coll name="edits" /> et <Coll name="scores" />, triés par z-score. Thème « — » : article pas encore classé. z-score : écart à l’activité habituelle de l’article (« – » = pas encore calculé).
                    Fenêtre terminée à <Timestamp iso={radar.data.time} />.
                  </SourceNote>
                </>
              )}
            </section>
          </div>

          <aside aria-labelledby="l-feed">
            <SectionHeader id="l-feed" title="Le fil" right="toutes les 5 s" />
            <Feed lang={lang} bots={!hideBots} quiet={pageDown} />
          </aside>
        </div>

        <section aria-labelledby="l-alerts">
          <SectionHeader
            id="l-alerts"
            title="Alertes du détecteur"
            right={alerts.data ? `${plural(alertRows.length, "alerte")}${activeAlerts ? `, dont ${fmtInt(activeAlerts)} des 2 dernières heures` : ""}` : null}
          />
          <p className="sh-note" style={{ maxWidth: "68ch" }}>
            Une alerte se déclenche quand un article reçoit en 5 minutes beaucoup plus de modifications que d’habitude (z-score supérieur à 3) par au moins 3
            contributeurs. Quatre modifications de trois personnes peuvent suffire : une alerte n’est pas forcément un événement mondial. Les alertes regroupées
            par sujet forment les <Link to="/themes">événements</Link>. Sans historique, l’habitude de l’article vaut 0 : le z-score est alors plafonné par le
            nombre de modifications.
          </p>
          {!alerts.data ? (
            alerts.error && !pageDown ? <ErrorState error={alerts.error} onRetry={alerts.refresh} retryMs={30000} /> : <Loading lines={8} />
          ) : !alerts.data.items.length ? (
            <EmptyState>Aucune alerte enregistrée.</EmptyState>
          ) : (
            <>
              <AlertsTable alerts={alertRows} showTheme liveCut={liveCut} scroll />
              <SourceNote>
                collection <Coll name="alerts" /> (MongoDB), les plus récentes d’abord. z-score en rouge : fenêtre des 2 dernières heures.
              </SourceNote>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
