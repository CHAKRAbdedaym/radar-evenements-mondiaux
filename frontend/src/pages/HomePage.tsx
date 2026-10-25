import { Link } from "react-router-dom";
import { api, ApiError, type EventSummary, type FrontPage, type Replay, type ThemeItem } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtDay, fmtInt, plural } from "../lib/format";
import { themePath } from "../lib/themes";
import { WikiImage } from "../components/blocks";
import { EventLead, EventStandard } from "../components/EventItem";
import { PageviewsChart, hourRange } from "../components/ReplayChart";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { ArticleLink, Coll, LangCode, LangList, MetaLine, SectionHeader, SourceNote, StatusLabel } from "../components/text";

const AL_HAOUZ_EN = "2023 Al Haouz earthquake";

/** Lead fallback (DESIGN_SYSTEM §4): the historical Al Haouz event, built from the real replay series. */
export function ArchiveLead({ replay, ev }: { replay: Replay; ev?: EventSummary | null }) {
  const en = replay.series.find((s) => s.lang === "en");
  // The 2023 title has pageviews in MongoDB, so its article endpoint exists (enrichment may still be null).
  const art = usePolling((s) => (ev?.thumbnail_url || !en ? Promise.resolve(null) : api.article("en", en.title_at_time || en.title, s).catch(() => null)), null);
  const quake = new Date(replay.event.time).getTime();
  const before = en?.items.find((i) => new Date(i.hour).getTime() === Math.floor(quake / 3600000) * 3600000 - 3600000);
  const thumb = ev?.thumbnail_url ?? art.data?.enrichment?.thumbnail_url ?? null;
  const description = ev?.description ?? art.data?.enrichment?.description ?? null;
  const headline =
    en?.peak && en.peak.views > 0
      ? `Séisme d’Al Haouz\u00a0: l’article anglais passe ${before ? `de ${fmtInt(before.views)} ` : ""}à ${fmtInt(en.peak.views)} vues par heure`
      : "Séisme d’Al Haouz : les vues horaires des articles Wikipédia";
  // No photo: the chart takes the right-hand columns instead of leaving them empty.
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
          {description ? `${description.charAt(0).toUpperCase()}${description.slice(1)}. ` : ""}
          Le {fmtDay(replay.event.time)} à 22:11 UTC, la secousse frappe la province d’Al Haouz, au sud de Marrakech. Notre flux de modifications n’existait pas encore : la
          courbe est reconstituée à partir des fichiers horaires de pages vues.
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

/** Events in significance order (the API order); an item without photo simply closes up. */
function SectionGrid({ events }: { events: EventSummary[] }) {
  return (
    <div className="cols-4">
      {events.slice(0, 4).map((ev) => (
        <EventStandard key={ev.id} ev={ev} />
      ))}
    </div>
  );
}

function ThemeSection({ id, label, events }: { id: string; label: string; events: EventSummary[] }) {
  return (
    <section aria-labelledby={`t-${id}`}>
      <SectionHeader id={`t-${id}`} title={<Link to={themePath(id)} className="hl">{label}</Link>} right={<Link to={themePath(id)}>Tout le thème →</Link>} />
      <SectionGrid events={events} />
    </section>
  );
}

function QuietThemes({ themes, stats }: { themes: { id: string; label: string }[]; stats: Map<string, ThemeItem> }) {
  if (!themes.length) return null;
  return (
    <section aria-labelledby="quiet">
      <SectionHeader id="quiet" title="Thèmes sans événement détecté" right={<Link to="/themes">Tous les thèmes →</Link>} />
      <ul className="cols-3" style={{ rowGap: 0 }}>
        {themes.map((t) => {
          const s = stats.get(t.id);
          return (
            <li key={t.id} className="ev-compact">
              <div style={{ minWidth: 0 }}>
                <h3 className="h-16">
                  <Link to={themePath(t.id)} className="hl">
                    {t.label}
                  </Link>
                </h3>
                <p className="meta num">
                  {s ? `${plural(s.edits_24h, "modification")} en 24 h · ${plural(s.articles, "article classé", "articles classés")}` : "Aucun événement pour l’instant."}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
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
                  <th>Langue</th>
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
                    <td>
                      <LangCode lang={a.lang} />
                    </td>
                    <td className="hide-m muted">{a.theme_label ?? "non classé"}</td>
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

/** Builds the front page from /api/themes when /api/frontpage is not deployed (same data, same order). */
async function loadFront(signal: AbortSignal): Promise<{ front: FrontPage | null; themes: ThemeItem[] | null }> {
  const [front, themes] = await Promise.all([
    api.frontpage(signal).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
    api
      .themes(signal)
      .then((t) => t.items)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
  ]);
  return { front, themes };
}

export default function HomePage() {
  useTitle("À la une");
  const data = usePolling(loadFront, 30000);
  const replay = usePolling((s) => api.replayAlHaouz(s), null);

  const front = data.data?.front ?? null;
  const themes = data.data?.themes ?? null;
  const stats = new Map((themes ?? []).map((t) => [t.id, t]));
  const sections =
    front?.sections ?? (themes ? themes.map((t) => ({ id: t.id, label: t.label, events: t.top_events })) : null);
  const lead = front?.lead ?? null;
  const leadId = lead?.id;
  const full = (sections ?? []).map((s) => ({ ...s, events: s.events.filter((e) => e.id !== leadId) })).filter((s) => s.events.length > 0);
  const quiet = (sections ?? []).filter((s) => !full.some((f) => f.id === s.id));
  const archiveLead = !lead || lead.kind === "historique";

  return (
    <>
    <h1 className="sr-only">À la une</h1>
    <div className="vr">
      {data.data === null && !data.error ? (
        <div className="split-lead">
          <Loading lines={5} height={28} />
          <Loading lines={1} height={260} />
        </div>
      ) : archiveLead ? (
        replay.data ? (
          <ArchiveLead replay={replay.data} ev={lead} />
        ) : replay.error ? (
          <ErrorState error={replay.error} onRetry={replay.refresh} />
        ) : (
          <Loading lines={5} height={28} />
        )
      ) : (
        <EventLead ev={lead!} kickerExtra={front?.lead_reason === "7j" ? <span>7 derniers jours</span> : null} />
      )}

      {data.error && !data.data ? (
        <ErrorState error={data.error} onRetry={data.refresh} retryMs={30000} />
      ) : sections === null && data.data ? (
        <EmptyState reason="Les thèmes s’afficheront dès que l’API des thèmes répondra.">Les rubriques par thème ne sont pas encore disponibles.</EmptyState>
      ) : null}

      {full.map((s) => (
        <ThemeSection key={s.id} id={s.id} label={s.label} events={s.events} />
      ))}
      {sections && <QuietThemes themes={quiet} stats={stats} />}
      <TopNow />
    </div>
    </>
  );
}
