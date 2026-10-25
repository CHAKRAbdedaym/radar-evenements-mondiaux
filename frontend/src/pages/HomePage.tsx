import { Link } from "react-router-dom";
import { api, ApiError, type EventSummary, type FrontPage, type Replay, type ThemeItem } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtInt, plural } from "../lib/format";
import { themePath } from "../lib/themes";
import { WikiImage } from "../components/blocks";
import { EventCompact, EventLead, EventStandard, eventStandfirst, isLeadEligible } from "../components/EventItem";
import { PageviewsChart, hourRange } from "../components/ReplayChart";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { ArticleLink, Coll, LangCode, LangList, MetaLine, SectionHeader, SourceNote, StatusLabel } from "../components/text";

const AL_HAOUZ_EN = "2023 Al Haouz earthquake";

/** Al Haouz as the front-page lead (archives), built from the real replay series. */
export function ArchiveLead({ replay, ev }: { replay: Replay; ev?: EventSummary | null }) {
  const en = replay.series.find((s) => s.lang === "en");
  // The 2023 title has pageviews in MongoDB, so its article endpoint exists (enrichment may still be null).
  const art = usePolling((s) => (ev?.thumbnail_url || !en ? Promise.resolve(null) : api.article("en", en.title_at_time || en.title, s).catch(() => null)), null);
  const quake = new Date(replay.event.time).getTime();
  const before = en?.items.find((i) => new Date(i.hour).getTime() === Math.floor(quake / 3600000) * 3600000 - 3600000);
  const thumb = ev?.thumbnail_url ?? art.data?.enrichment?.thumbnail_url ?? null;
  const headline =
    en?.peak && en.peak.views > 0
      ? `Séisme d’Al Haouz : l’article anglais passe ${before ? `de ${fmtInt(before.views)} ` : ""}à ${fmtInt(en.peak.views)} vues par heure`
      : "Séisme d’Al Haouz : les vues horaires des articles Wikipédia";
  const chart = (
    <figure className={thumb ? "ev-lead-chart" : ""}>
      <div className={thumb ? "" : "chart-frame"}>
        {!thumb && (
          <div className="chart-head">
            <span className="t-14">Vues par heure des articles sur le séisme</span>
          </div>
        )}
        <PageviewsChart series={replay.series} eventTime={quake} height={thumb ? 170 : 300} />
      </div>
      <p className="source">
        Fichiers horaires de pages vues (ordinateur + mobile), collection <Coll name="pageviews" />. <Link to="/archives/al-haouz">Voir la reconstitution complète →</Link>
      </p>
    </figure>
  );
  return (
    <article className="ev-lead split-lead">
      <div>
        <p className="kicker" style={{ display: "flex", gap: "0 12px", flexWrap: "wrap", marginBottom: 12 }}>
          <span>Archives</span>
          <Link to={themePath("catastrophes")}>Catastrophes & accidents</Link>
          <StatusLabel status="historique" />
        </p>
        <h2 className="t-56">
          <Link to={ev ? `/evenement/${ev.id}` : "/archives/al-haouz"} className="hl">
            {headline}
          </Link>
        </h2>
        <p className="standfirst">
          {ev ? eventStandfirst(ev) : "Séisme de magnitude 6,8 (USGS) dans la province d’Al Haouz, au sud de Marrakech, le 8 septembre 2023 à 22:11 UTC."} Notre flux de
          modifications n’existait pas encore : la courbe est reconstituée à partir des fichiers horaires de pages vues.
        </p>
        <MetaLine
          items={[
            <LangList langs={replay.series.map((s) => s.lang)} />,
            en?.peak ? `pic ${hourRange(new Date(en.peak.hour).getTime())}` : null,
            `${fmtInt(replay.hours_loaded)} heures chargées`,
          ]}
        />
        {thumb && chart}
      </div>
      <div>{thumb ? <WikiImage eager url={thumb} lang="en" title={AL_HAOUZ_EN} alt="Séisme d’Al Haouz, 2023" width={960} /> : chart}</div>
    </article>
  );
}

/**
 * One theme section (DESIGN_SYSTEM §4): lead-eligible events as standard items
 * (≥ 4 → 4 × 3 columns; 1–3 → first item 6 columns + compact list 6 columns),
 * other events as compact one-line items (max 3). No events → one line.
 */
function ThemeSection({ id, label, events, stats }: { id: string; label: string; events: EventSummary[]; stats?: ThemeItem }) {
  const eligible = events.filter(isLeadEligible);
  const others = events.filter((e) => !isLeadEligible(e));
  const moreCount = stats ? Math.max(0, stats.events - events.length) : 0;
  const header = (
    <SectionHeader
      id={`t-${id}`}
      title={
        <Link to={themePath(id)} className="hl">
          {label}
        </Link>
      }
      right={<Link to={themePath(id)}>{moreCount > 0 ? `Tout le thème (${plural(stats!.events, "événement")}) →` : "Tout le thème →"}</Link>}
    />
  );
  if (!events.length) {
    return (
      <section aria-labelledby={`t-${id}`}>
        {header}
        <EmptyState>
          Aucun événement détecté{stats ? ` · ${plural(stats.edits_24h, "modification")} d’articles du thème en 24 h` : ""}.
        </EmptyState>
      </section>
    );
  }
  const signals = (items: EventSummary[]) =>
    items.length ? (
      <div className="signals">
        <p className="kicker">Articles très modifiés, sans événement majeur</p>
        <ul className="cols-3" style={{ rowGap: 0 }}>
          {items.slice(0, 3).map((ev) => (
            <EventCompact key={ev.id} ev={ev} />
          ))}
        </ul>
      </div>
    ) : null;

  let body;
  if (eligible.length >= 4) {
    const row = eligible.slice(0, 4);
    const allPhotos = row.every((e) => e.thumbnail_url);
    body = (
      <>
        <div className="cols-4">
          {row.map((ev) => (
            <EventStandard key={ev.id} ev={ev} photo={allPhotos} reserveKicker={row.some((e) => e.status === "en cours" || e.status === "historique")} />
          ))}
        </div>
        {signals(others)}
      </>
    );
  } else if (eligible.length >= 1) {
    const [first, ...rest] = eligible;
    const side = rest.length ? rest : others.slice(0, 3);
    body = (
      <>
        <div className="split-6">
          <EventStandard ev={first} />
          {side.length > 0 && (
            <ul className="compact-col">
              {side.map((ev) => (
                <EventCompact key={ev.id} ev={ev} />
              ))}
            </ul>
          )}
        </div>
        {rest.length ? signals(others) : null}
      </>
    );
  } else {
    body = signals(others);
  }
  return (
    <section aria-labelledby={`t-${id}`}>
      {header}
      {body}
    </section>
  );
}

function TopNow() {
  const top = usePolling((s) => api.topEdits({ minutes: 60, limit: 10 }, s), 30000);
  return (
    <section aria-labelledby="top-now">
      <SectionHeader id="top-now" title="Les articles les plus modifiés depuis une heure" right={<Link to="/direct">En direct →</Link>} />
      {!top.data ? (
        top.error ? <ErrorState error={top.error} onRetry={top.refresh} retryMs={30000} /> : <Loading lines={6} />
      ) : !top.data.items.length ? (
        <EmptyState>Aucune modification humaine depuis une heure.</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Article</th>
                  <th className="lang-cell">Langue</th>
                  <th className="hide-m">Thème</th>
                  <th className="r">Modifications</th>
                  <th className="r hide-m">Contributeurs</th>
                </tr>
              </thead>
              <tbody>
                {top.data.items.map((a) => (
                  <tr key={`${a.lang}:${a.title}`}>
                    <td className="title-cell">
                      <ArticleLink lang={a.lang} title={a.title} />
                    </td>
                    <td className="lang-cell">
                      <LangCode lang={a.lang} />
                    </td>
                    <td className="hide-m theme-cell">
                      {a.theme && a.theme_label ? (
                        <Link to={themePath(a.theme)} className="quiet">
                          {a.theme_label}
                        </Link>
                      ) : (
                        <span className="faint">non classé</span>
                      )}
                    </td>
                    <td className="r">{fmtInt(a.edits)}</td>
                    <td className="r hide-m">{fmtInt(a.distinct_users)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceNote>
            Wikimedia EventStreams, collection <Coll name="edits" /> (MongoDB), modifications humaines seulement.
          </SourceNote>
        </>
      )}
    </section>
  );
}

/** Builds the front page from /api/themes when /api/frontpage is not deployed (same data). */
async function loadFront(signal: AbortSignal): Promise<{ front: FrontPage | null; themes: ThemeItem[] | null }> {
  const notFound = (e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  };
  const [front, themes] = await Promise.all([api.frontpage(signal).catch(notFound), api.themes(signal).then((t) => t.items).catch(notFound)]);
  return { front, themes };
}

export default function HomePage() {
  useTitle("À la une");
  const data = usePolling(loadFront, 30000);
  const lead = data.data?.front?.lead ?? null;
  const archiveMode = !data.data?.front || !lead || lead.kind === "historique";
  const replay = usePolling((s) => (archiveMode ? api.replayAlHaouz(s) : Promise.resolve(null)), null, [archiveMode]);

  const front = data.data?.front ?? null;
  const themes = data.data?.themes ?? null;
  const stats = new Map((themes ?? []).map((t) => [t.id, t]));
  const rawSections = front?.sections ?? (themes ? themes.map((t) => ({ id: t.id, label: t.label, events: t.top_events })) : null);
  // Order by activity of the last 24 h (most active first), "Autres" last.
  const sections = rawSections
    ? [...rawSections]
        .map((s) => ({ ...s, events: s.events.filter((e) => e.id !== lead?.id) }))
        .sort((a, b) => {
          if (a.id === "autres") return 1;
          if (b.id === "autres") return -1;
          return (stats.get(b.id)?.edits_24h ?? 0) - (stats.get(a.id)?.edits_24h ?? 0);
        })
    : null;

  // API down and nothing received yet: one clear message for the whole page, not one per block.
  if (data.error && !data.data) {
    return (
      <div>
        <header className="page-head">
          <h1 className="t-40">À la une</h1>
          <p className="standfirst">La une ne peut pas s’afficher pour l’instant : l’API qui lit MongoDB ne répond pas.</p>
        </header>
        <ErrorState error={data.error} onRetry={data.refresh} retryMs={30000} />
      </div>
    );
  }

  return (
    <>
      <h1 className="sr-only">À la une</h1>
      <div className="vr">
        {data.data === null && !data.error ? (
          <div className="split-lead">
            <Loading lines={5} height={28} />
            <Loading lines={1} height={260} />
          </div>
        ) : !archiveMode ? (
          <EventLead ev={lead!} kickerExtra={front?.lead_reason === "7j" ? <span>7 derniers jours</span> : null} />
        ) : replay.data ? (
          <ArchiveLead replay={replay.data} ev={lead} />
        ) : replay.error ? (
          <ErrorState error={replay.error} onRetry={replay.refresh} />
        ) : (
          <Loading lines={5} height={28} />
        )}

        {sections === null && data.data ? (
          <EmptyState reason="Les rubriques s’afficheront dès que l’API des thèmes répondra.">Les rubriques par thème ne sont pas encore disponibles.</EmptyState>
        ) : null}

        {(sections ?? []).map((s) => (
          <ThemeSection key={s.id} id={s.id} label={s.label} events={s.events} stats={stats.get(s.id)} />
        ))}
        <TopNow />
      </div>
    </>
  );
}
