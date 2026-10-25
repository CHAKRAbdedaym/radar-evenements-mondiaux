import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api, type ThemesTimeline } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtInt, fmtTimeUtc, plural } from "../lib/format";
import { eventPath, themePath } from "../lib/themes";
import { CHART, THEME_SERIES } from "../styles/chart";
import { ChartFrame, LineChart, Sparkline } from "../components/charts";
import { hourRange } from "../components/ReplayChart";
import { firstNonZero } from "../lib/wikitext";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { displayTitle } from "../components/EventItem";
import { Coll, SectionHeader, SourceNote, StatusLabel } from "../components/text";

function ThemesChart({ tl: raw }: { tl: ThemesTimeline }) {
  // Start at the first hour with data (DESIGN_SYSTEM §2: the x-axis starts at the first data point).
  const start = firstNonZero(raw.items.map((i) => raw.themes.reduce((a, t) => a + (i[t.id] ?? 0), 0) + (i.non_classe ?? 0)));
  const tl = { ...raw, items: raw.items.slice(start) };
  const trimmed = start > 0;
  const xs = tl.items.map((i) => new Date(i.t).getTime());
  const totals = tl.themes.map((t) => ({ ...t, sum: tl.items.reduce((a, i) => a + (i[t.id] ?? 0), 0) }));
  // Series 1–3 = the three most active real themes; "Autres" and everything else in grey.
  const top = [...totals]
    .filter((t) => t.sum > 0 && t.id !== "autres")
    .sort((a, b) => b.sum - a.sum)
    .slice(0, THEME_SERIES.length);
  const rest = totals.filter((t) => !top.some((x) => x.id === t.id));
  const nonClasse = tl.items.reduce((a, i) => a + (i.non_classe ?? 0), 0);
  if (!top.length) return <EmptyState>Aucune modification d’article classé sur les dernières {tl.hours} heures.</EmptyState>;
  const series = [
    ...top.map((t, k) => ({ key: t.id, label: t.label, color: THEME_SERIES[k], values: tl.items.map((i) => i[t.id] ?? 0) })),
    ...(rest.some((r) => r.sum > 0)
      ? [{ key: "rest", label: "Autres et thèmes restants", color: CHART.rest, strokeWidth: 1.5, values: tl.items.map((i) => rest.reduce((a, r) => a + (i[r.id] ?? 0), 0)) }]
      : []),
  ];
  return (
    <ChartFrame
      title={`${trimmed ? `Modifications humaines par heure depuis ${fmtTimeUtc(xs[0])}` : `Modifications humaines par heure, ${tl.hours} dernières heures`} ; dernière heure en cours (point creux), non comptée`}
      source={
        <SourceNote>
          collections <Coll name="edits" /> et <Coll name="articles" /> (MongoDB). Les {fmtInt(nonClasse)} modifications sur des articles pas encore classés ne sont
          pas comptées.{trimmed ? ` Aucune modification enregistrée entre ${fmtTimeUtc(raw.items[0].t)} et ${fmtTimeUtc(xs[0])} sur cette fenêtre de ${raw.hours} h.` : ""}
        </SourceNote>
      }
    >
      <LineChart
        xs={xs}
        series={series}
        height={240}
        endValues={false}
        partialLast="heure en cours"
        xFormat={(t) => fmtTimeUtc(t).replace(" UTC", "")}
        tipTitle={hourRange}
        unit="modifications"
        ariaLabel={`Modifications par heure : ${top.map((t) => `${t.label} ${fmtInt(t.sum)}`).join(", ")}.`}
      />
    </ChartFrame>
  );
}

export default function ThemesPage() {
  useTitle("Thèmes");
  const themes = usePolling((s) => api.themes(s), 60000);
  const tl = usePolling((s) => api.themesTimeline(24, s), 60000);
  // Same source as the Données page for the classified-articles total.
  const cls = usePolling((s) => api.classification(s).catch(() => null), 60000);
  const items = themes.data?.items ?? [];
  // The hourly sparkline only makes sense with at least 4 hours of data.
  // Sparklines: from the first hour with data to the last COMPLETE hour (the current hour is dropped).
  const trendOf = (v: number[]) => v.slice(firstNonZero(v), -1);
  const showTrend = items.some((t) => trendOf(t.trend).length >= 4);
  const totals = useMemo(
    () => ({ events: items.reduce((a, t) => a + t.events, 0), active: items.reduce((a, t) => a + t.active_events, 0), articles: items.reduce((a, t) => a + t.articles, 0) }),
    [items],
  );

  return (
    <div>
      <header className="page-head">
        <h1 className="t-40">Thèmes</h1>
        <p className="standfirst">
          Dix rubriques fixes, attribuées à partir de Wikidata. <Link to="/methode#themes">Méthode →</Link>
        </p>
        {themes.data && (
          <p className="meta num">
            {totals.events
              ? `${plural(totals.events, "événement")}, ${totals.active ? `dont ${fmtInt(totals.active)} en cours` : "aucun en cours"}`
              : "Aucun événement détecté pour l’instant"} ·{" "}
            {cls.data ? plural(cls.data.total_articles, "article classé", "articles classés") : plural(totals.articles, "article classé", "articles classés")}
          </p>
        )}
      </header>

      <div className="vr">
        <section aria-labelledby="th-table">
          <SectionHeader id="th-table" title="Les dix thèmes" right="24 dernières heures" />
          {!themes.data ? (
            themes.error ? <ErrorState error={themes.error} onRetry={themes.refresh} retryMs={60000} /> : <Loading lines={10} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Thème</th>
                      <th className="r">Événements</th>
                      <th className="r hide-m">En cours</th>
                      <th className="r">Modifications (24 h)</th>
                      <th className="r hide-m">Articles classés</th>
                      {showTrend && <th className="hide-m">Par heure</th>}
                      <th className="hide-m">Dernier événement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((t) => {
                      const ev = t.top_events[0];
                      return (
                        <tr key={t.id}>
                          <td className="nw">
                            <Link to={themePath(t.id)} className="hl serif" style={{ fontSize: 17, fontWeight: 600 }}>
                              {t.label}
                            </Link>
                          </td>
                          <td className="r">{t.events ? fmtInt(t.events) : <span className="faint">—</span>}</td>
                          <td className="r hide-m">{t.active_events ? fmtInt(t.active_events) : <span className="faint">—</span>}</td>
                          <td className="r">{fmtInt(t.edits_24h)}</td>
                          <td className="r hide-m">{fmtInt(t.articles)}</td>
                          {showTrend && (
                            <td className="hide-m">
                              {trendOf(t.trend).length >= 4 ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                  <Sparkline values={trendOf(t.trend)} label={`${t.label} : modifications par heure, pic ${Math.max(...trendOf(t.trend))}`} />
                                  <span className="t-12 muted nw">pic {fmtInt(Math.max(...trendOf(t.trend)))}</span>
                                </span>
                              ) : (
                                <span className="faint">–</span>
                              )}
                            </td>
                          )}
                          <td className="hide-m" style={{ maxWidth: 280 }}>
                            {ev ? (
                              <>
                                <Link to={eventPath(ev.id)}>{displayTitle(ev)}</Link>{" "}
                                <span className="t-12">
                                  <StatusLabel status={ev.status} />
                                </span>
                              </>
                            ) : (
                              <span className="faint">aucun</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <SourceNote>
                collections <Coll name="events" />, <Coll name="articles" /> et <Coll name="edits" /> (MongoDB), modifications humaines.
              </SourceNote>
            </>
          )}
        </section>

        <section aria-labelledby="th-chart">
          <SectionHeader id="th-chart" title="Quels thèmes bougent" right="les trois plus actifs, le reste en gris" />
          {!tl.data ? tl.error ? <ErrorState error={tl.error} onRetry={tl.refresh} retryMs={60000} /> : <Loading lines={1} height={280} /> : <ThemesChart tl={tl.data} />}
        </section>
      </div>
    </div>
  );
}
