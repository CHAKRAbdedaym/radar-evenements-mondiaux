import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type EventSummary } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtInt, fmtTimeUtc, plural } from "../lib/format";
import { themePath, themeSourceLabel } from "../lib/themes";
import { ChartFrame, ColumnChart } from "../components/charts";
import { EventCompact, EventLead, EventStandard, isLeadEligible } from "../components/EventItem";
import { hourRange } from "../components/ReplayChart";
import { firstNonZero } from "../lib/wikitext";
import { useStreamGaps } from "../lib/gaps";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { ArticleLink, Coll, LangCode, SectionHeader, SourceNote } from "../components/text";

/** Events by significance, lead-eligible first (CONTRACT §7; the API already orders them this way when v2.1 is deployed). */
function bySignificance(evs: EventSummary[]): EventSummary[] {
  return [...evs].sort((a, b) => {
    const ea = isLeadEligible(a) ? 1 : 0;
    const eb = isLeadEligible(b) ? 1 : 0;
    if (ea !== eb) return eb - ea;
    const la = a.status === "en cours" ? 1 : 0; // spec §4: prefer "en cours" for the lead
    const lb = b.status === "en cours" ? 1 : 0;
    if (la !== lb) return lb - la;
    return (b.significance ?? 0) - (a.significance ?? 0);
  });
}

function ThemeTabs({ current }: { current: string }) {
  const themes = usePolling((s) => api.themes(s), null);
  if (!themes.data) return null;
  return (
    <nav className="tabs tight edge" aria-label="Autres thèmes">
      {themes.data.items.map((t) => (
        <Link key={t.id} to={themePath(t.id)} className={t.id === current ? "on" : ""} aria-current={t.id === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export default function ThemePage() {
  const { id = "" } = useParams();
  const [showAll, setShowAll] = useState(false);
  const known = useStreamGaps();
  const st = usePolling((s) => api.theme(id, s), 60000, [id]);
  const d = st.data;
  useTitle(d ? d.label : "Thème");

  if (!d) {
    return (
      <div>
        <ThemeTabs current={id} />
        {st.error instanceof ApiError && st.error.status === 400 ? (
          <header className="page-head">
            <p className="kicker">Thème</p>
            <h1 className="t-40">Thème inconnu</h1>
            <p className="standfirst">
              « {id} » ne fait pas partie des dix thèmes. <Link to="/themes">Voir la liste des thèmes</Link>.
            </p>
          </header>
        ) : st.error ? (
          <ErrorState error={st.error} onRetry={st.refresh} retryMs={60000} />
        ) : (
          <>
            <Loading lines={2} height={36} />
            <Loading lines={6} />
          </>
        )}
      </div>
    );
  }

  const events = bySignificance(d.events);
  const lead = events.find(isLeadEligible) ?? null;
  const others = events.filter((e) => e !== lead);
  const live = others.filter((e) => e.status === "en cours");
  const past = others.filter((e) => e.status !== "en cours");
  const tStart = Math.min(d.timeline.length - 1, firstNonZero(d.timeline.map((p) => p.edits)));
  const timeline = d.timeline.slice(tStart);
  const xs = timeline.map((p) => new Date(p.t).getTime());
  const refT = d.ref_time ? new Date(d.ref_time).getTime() : null;
  const partialHour = refT !== null && xs.length > 0 && refT < xs[xs.length - 1] + 3600 * 1000;
  const [allArts, setAllArts] = [showAll, setShowAll];

  return (
    <div>
      <ThemeTabs current={id} />
      <header className="page-head">
        <p className="kicker">Thème</p>
        <h1 className="t-40">{d.label}</h1>
        <p className="standfirst num">
          {d.counts.events === 0
            ? "Aucun événement détecté pour l’instant"
            : `${plural(d.counts.events, "événement")}, ${d.counts.active_events ? `dont ${fmtInt(d.counts.active_events)} en cours` : "aucun en cours"}`}{" "}
          · {plural(d.counts.edits_24h, "modification")} en 24 h · {plural(d.counts.articles, "article classé", "articles classés")}
        </p>
      </header>

      <div className="vr">
        {lead ? (
          <EventLead ev={lead} size="t-40" />
        ) : (
          <EmptyState reason="Un événement apparaît quand le détecteur relève un pic anormal de modifications sur un article de ce thème.">
            Aucun événement dans ce thème pour l’instant.
          </EmptyState>
        )}

        {live.length > 0 && (
          <section aria-labelledby="th-live">
            <SectionHeader id="th-live" title="En cours" />
            <div className="cols-2">
              {live.map((ev) => (
                <EventStandard key={ev.id} ev={ev} />
              ))}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section aria-labelledby="th-past">
            <SectionHeader id="th-past" title="Autres événements" right={plural(past.length, "événement")} />
            <ul className="cols-2" style={{ rowGap: 0 }}>
              {past.map((ev) => (
                <EventCompact key={ev.id} ev={ev} />
              ))}
            </ul>
          </section>
        )}

        <div className="split-main">
          <section aria-labelledby="th-arts">
            <SectionHeader id="th-arts" title="Articles les plus modifiés (24 h)" />
            {d.top_articles.length === 0 ? (
              <EmptyState>Aucun article de ce thème n’a été modifié ces dernières 24 heures.</EmptyState>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Article</th>
                        <th className="lang-cell">Langue</th>
                        <th className="r">Modifications</th>
                        <th className="r hide-m">Contributeurs</th>
                        <th className="hide-m">Source du thème</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(allArts ? d.top_articles : d.top_articles.slice(0, 10)).map((a) => (
                        <tr key={`${a.lang}:${a.title}`}>
                          <td className="title-cell">
                            <ArticleLink lang={a.lang} title={a.title} />
                          </td>
                          <td className="lang-cell">
                            <LangCode lang={a.lang} />
                          </td>
                          <td className="r">{fmtInt(a.edits_24h)}</td>
                          <td className="r hide-m">{fmtInt(a.distinct_users)}</td>
                          <td className="hide-m muted nw">{themeSourceLabel(a.theme_source)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.top_articles.length > 10 && (
                  <button type="button" className="btn-text" style={{ marginTop: 8 }} onClick={() => setAllArts(!allArts)}>
                    {allArts ? "Afficher les 10 premiers" : `Afficher les ${fmtInt(d.top_articles.length)} articles`}
                  </button>
                )}
                <SourceNote>
                  collections <Coll name="edits" /> et <Coll name="articles" /> (MongoDB), modifications humaines.
                </SourceNote>
              </>
            )}
          </section>
          <section aria-labelledby="th-tl">
            <SectionHeader id="th-tl" title="Modifications par heure" />
            {xs.length ? (
              <ChartFrame
                title={tStart > 0 ? `Depuis ${fmtTimeUtc(xs[0])}` : "24 dernières heures, UTC"}
                source={
                  <SourceNote>
                    collection <Coll name="edits" />, articles de ce thème.{tStart > 0
                      ? known.gaps.some((g) => xs[0] - 3600 * 1000 >= g.from && xs[0] - 3600 * 1000 < g.to)
                        ? ` Flux interrompu avant ${fmtTimeUtc(xs[0])} : aucune modification reçue, toutes pages confondues.`
                        : ` Aucune modification de ce thème avant ${fmtTimeUtc(xs[0])} sur les 24 dernières heures.`
                      : ""}
                    {partialHour ? " Dernière barre en pointillé : heure en cours, incomplète." : ""}
                  </SourceNote>
                }
              >
                <ColumnChart
                  xs={xs}
                  values={timeline.map((p) => p.edits)}
                  partialLast={partialHour}
                  bucketMs={3600000}
                  height={200}
                  xTickEvery={xs.length > 12 ? 6 : 1}
                  xFormat={(t) => fmtTimeUtc(t).replace(" UTC", "")}
                  tipTitle={hourRange}
                  unit="modifications"
                  ariaLabel={`${d.label} : ${fmtInt(d.counts.edits_24h)} modifications en 24 h.`}
                />
              </ChartFrame>
            ) : (
              <EmptyState>Pas de données horaires.</EmptyState>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
