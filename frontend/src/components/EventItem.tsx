import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, type EventSummary, type Lang } from "../api";
import { useFeedStatus, usePolling } from "../hooks/usePolling";
import { fmtDay, fmtDayRange, fmtInt, fmtTimeUtc, plural } from "../lib/format";
import { gapBuckets, useStreamGaps } from "../lib/gaps";
import { LANG_NAME, LANG_ORDER, articlePath, dirOf } from "../lib/lang";
import { eventPath } from "../lib/themes";
import { cleanSnippet, isProse } from "../lib/wikitext";
import { WikiImage } from "./blocks";
import { ChartFrame, ColumnChart, Sparkline } from "./charts";
import { Kicker, LangCode, LangList, MetaLine, StatusLabel, Timestamp } from "./text";

/** Language of the article the event's photo/description come from (en > fr > ar, CONTRACT §5.9). */
export function imageLang(ev: EventSummary): { lang: Lang; title: string } | null {
  for (const l of ["en", "fr", "ar"] as Lang[]) if (ev.titles?.[l]) return { lang: l, title: ev.titles[l] as string };
  return null;
}

/** Title language for display direction (best title = fr > en > ar). */
export function titleLang(ev: EventSummary): Lang {
  for (const l of LANG_ORDER) if (ev.titles?.[l] === ev.title) return l;
  return "en";
}

export function langNames(langs: Lang[]): string {
  const names = LANG_ORDER.filter((l) => langs.includes(l)).map((l) => LANG_NAME[l]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The Wikidata description only when it is in French (never print English in a French standfirst). */
export function frDescription(ev: EventSummary): string | null {
  if (!ev.description || ev.description_lang !== "fr") return null;
  return cap(ev.description);
}

/** Factual French line from real numbers: "87 modifications par 20 contributeurs sur Wikipédia en anglais, du 16 au 17 oct." */
export function eventFacts(ev: EventSummary): string {
  const langs = ev.langs.length ? ` sur Wikipédia en ${langNames(ev.langs)}` : "";
  const when = ev.first_seen && ev.last_activity ? `, ${fmtDayRange(ev.first_seen, ev.last_activity)}` : "";
  const line = `${plural(ev.total_edits, "modification")} par ${plural(ev.distinct_users, "contributeur")}${langs}${when}`;
  return line.endsWith(".") ? line : `${line}.`;
}

/** Editorial line for the one curated historical event (facts: USGS magnitude, time of the quake). */
const HISTORIC_COPY: Record<string, string> = {
  "alhaouz-2023": "Séisme de magnitude 6,8 (USGS) dans la province d’Al Haouz, au sud de Marrakech, le 8 septembre 2023 à 22:11 UTC.",
};

/** Editorial headline for curated historical events; otherwise the best Wikipedia title. */
const HISTORIC_TITLE: Record<string, string> = { "alhaouz-2023": "Séisme d’Al Haouz (8 septembre 2023)" };
export const displayTitle = (ev: EventSummary): string => HISTORIC_TITLE[ev.id] ?? ev.title;

export function eventStandfirst(ev: EventSummary): string {
  if (ev.kind === "historique") return HISTORIC_COPY[ev.id] ?? frDescription(ev) ?? "Événement historique reconstitué à partir des vues horaires Wikipédia.";
  return frDescription(ev) ?? eventFacts(ev);
}

/** Small, labelled foreign-language description (object pages only). */
export function ForeignDescription({ text, lang }: { text: string | null | undefined; lang: Lang | null | undefined }) {
  if (!text || !lang || lang === "fr") return null;
  return (
    <p className="foreign" style={{ marginTop: 8 }}>
      <span lang={lang} dir={dirOf(lang)}>
        « {text} »
      </span>{" "}
      <span className="lbl">— description Wikidata (en {LANG_NAME[lang]})</span>
    </p>
  );
}

export function eventMeta(ev: EventSummary, opts: { short?: boolean } = {}): ReactNode[] {
  if (ev.kind === "historique") {
    return [ev.langs.length ? <LangList langs={ev.langs} /> : null, ev.first_seen ? fmtDay(ev.first_seen) : null, "vues horaires Wikipédia"];
  }
  const live = ev.status === "en cours";
  return [
    ev.langs.length ? <LangList langs={ev.langs} /> : null,
    live ? <Timestamp iso={ev.last_activity} /> : ev.first_seen && ev.last_activity ? fmtDayRange(ev.first_seen, ev.last_activity).replace(/^le /, "") : null,
    opts.short ? null : plural(ev.distinct_users, "contributeur"),
    plural(ev.total_edits, "modification"),
  ];
}

function sparkLabel(ev: EventSummary): string {
  const max = Math.max(0, ...ev.spark);
  const last = ev.spark[ev.spark.length - 1] ?? 0;
  return `Modifications par heure sur 24 h : maximum ${fmtInt(max)}, dernière heure ${fmtInt(last)}.`;
}

/** Status only when it carries news: "● En cours" or "Historique". Ended events get none. */
const hasStatus = (ev: EventSummary) => ev.status === "en cours" || ev.status === "historique";

function Headline({ ev, className }: { ev: EventSummary; className: string }) {
  const l = titleLang(ev);
  return (
    <h3 className={className}>
      <Link to={eventPath(ev.id)} className="hl" dir={l === "ar" ? "rtl" : undefined} lang={HISTORIC_TITLE[ev.id] ? "fr" : l}>
        {displayTitle(ev)}
      </Link>
    </h3>
  );
}

/** Standard item: optional photo (no visible credit in lists), 20px headline, French line, meta; sparkline only when live. */
export function EventStandard({
  ev,
  showKicker = false,
  photo = true,
  reserveKicker = false,
}: {
  ev: EventSummary;
  showKicker?: boolean;
  photo?: boolean;
  /** Keep an empty status line so headlines stay top-aligned in a row where other items have one. */
  reserveKicker?: boolean;
}) {
  const img = imageLang(ev);
  const live = ev.status === "en cours";
  return (
    <article className={`ev-std ${photo && ev.thumbnail_url ? "has-photo" : ""}`}>
      {photo && <WikiImage url={ev.thumbnail_url} lang={img?.lang} title={img?.title} alt={ev.title} credit="none" />}
      {showKicker ? (
        <Kicker theme={ev.theme} label={ev.theme_label} extra={hasStatus(ev) ? <span style={{ marginLeft: 12 }}><StatusLabel status={ev.status} /></span> : null} />
      ) : hasStatus(ev) ? (
        <p className="kicker">
          <StatusLabel status={ev.status} />
        </p>
      ) : reserveKicker ? (
        <p className="kicker" aria-hidden="true">
          &nbsp;
        </p>
      ) : null}
      <Headline ev={ev} className="t-20" />
      <p className="ev-desc">{eventStandfirst(ev)}</p>
      <div className="ev-foot">
        <MetaLine items={eventMeta(ev, { short: true })} />
        {live && ev.spark.some((v) => v > 0) && <Sparkline values={ev.spark} alert label={sparkLabel(ev)} />}
      </div>
    </article>
  );
}

/** Compact item: 16px headline + one meta line, for dense lists. */
export function EventCompact({ ev, showTheme = false }: { ev: EventSummary; showTheme?: boolean }) {
  return (
    <li className="ev-compact">
      <Headline ev={ev} className="h-16" />
      <MetaLine
        items={[
          showTheme ? ev.theme_label : null,
          hasStatus(ev) ? <StatusLabel status={ev.status} /> : null,
          ...eventMeta(ev, { short: true }),
        ]}
      />
    </li>
  );
}

/** The event's 24 hourly values as a framed column chart, with the stream gap hatched and the current hour dashed. */
function SparkColumns({ ev }: { ev: EventSummary }) {
  const HOUR = 3600 * 1000;
  const known = useStreamGaps();
  const feed = useFeedStatus();
  const end = ev.last_activity ? Math.floor(new Date(ev.last_activity).getTime() / HOUR) * HOUR : 0;
  const xs = ev.spark.map((_, i) => end - (ev.spark.length - 1 - i) * HOUR);
  const { flags, bands } = gapBuckets(xs, ev.spark, HOUR, known);
  const total = ev.spark.reduce((a, v) => a + v, 0);
  const refT = feed.refTime ? new Date(feed.refTime).getTime() : null;
  const partial = refT !== null && refT < end + HOUR;
  return (
    <ChartFrame
      title={`Modifications humaines par heure, jusqu’à ${refT ? fmtTimeUtc(refT) : fmtTimeUtc(end + HOUR)}${partial ? " (heure en cours incomplète)" : ""}`}
      source={<p className="source">Source : collection <code>edits</code> (MongoDB), articles de l’événement, 24 dernières heures.</p>}
    >
      <ColumnChart
        xs={xs}
        values={ev.spark}
        bucketMs={HOUR}
        height={220}
        xTickEvery={6}
        bands={bands}
        skip={flags}
        partialLast={partial}
        xFormat={(t) => fmtTimeUtc(t).replace(" UTC", "")}
        tipTitle={(t) => `${fmtTimeUtc(t).replace(" UTC", "")}–${fmtTimeUtc(t + HOUR)}`}
        unit="modifications"
        ariaLabel={`${fmtInt(total)} modifications sur 24 heures.`}
      />
    </ChartFrame>
  );
}

/** Three latest meaningful added texts + the event's articles (fills the lead's text column). */
function LeadTexts({ ev }: { ev: EventSummary }) {
  const st = usePolling((s) => api.event(ev.id, s), 60000, [ev.id]);
  if (!st.data) return null;
  const texts = st.data.texts
    .map((t) => ({ ...t, clean: cleanSnippet(t.added_text) }))
    .filter((t) => isProse(t.clean))
    .slice(0, 3);
  const arts = st.data.event.articles;
  if (!texts.length && !arts.length) return null;
  return (
    <ul className="lead-texts">
      {texts.map((t) => (
        <li key={t.id}>
          <span className="muted">
            <LangCode lang={t.lang} /> · {fmtTimeUtc(t.timestamp)}
          </span>
          <p className="line" dir={dirOf(t.lang)} lang={t.lang}>
            {t.clean.slice(0, 220)}
          </p>
        </li>
      ))}
      {arts.length > 0 && (
        <li className="muted">
          {arts.length === 1 ? "Suivi sur un seul article : " : `Suivi sur ${fmtInt(arts.length)} articles : `}
          {arts.map((a, i) => (
            <span key={`${a.lang}:${a.title}`}>
              {i > 0 && ", "}
              <Link to={articlePath(a.lang, a.title)} dir={a.lang === "ar" ? "rtl" : undefined}>
                {a.title}
              </Link>{" "}
              ({a.lang})
            </span>
          ))}
        </li>
      )}
    </ul>
  );
}

/** Lead item (7/5 split): kicker, big headline, French standfirst, meta, latest texts; photo or chart in the right 5 columns. */
export function EventLead({
  ev,
  kickerExtra,
  chart,
  size = "t-56",
  as = "h2",
}: {
  ev: EventSummary;
  kickerExtra?: ReactNode;
  chart?: ReactNode;
  size?: "t-56" | "t-40";
  as?: "h1" | "h2";
}) {
  const img = imageLang(ev);
  const l = titleLang(ev);
  const H = as;
  const hasSpark = ev.kind !== "historique" && ev.spark.some((v) => v > 0);
  return (
    <article className="ev-lead split-lead">
      <div>
        <Kicker
          theme={ev.theme}
          label={ev.theme_label}
          extra={
            <>
              {hasStatus(ev) && <StatusLabel status={ev.status} />}
              {kickerExtra}
            </>
          }
        />
        <H className={size}>
          <Link to={eventPath(ev.id)} className="hl" dir={l === "ar" ? "rtl" : undefined} lang={HISTORIC_TITLE[ev.id] ? "fr" : l}>
            {displayTitle(ev)}
          </Link>
        </H>
        <p className="standfirst">{eventStandfirst(ev)}</p>
        <MetaLine items={eventMeta(ev)} />
        {chart && <div className="ev-lead-chart">{chart}</div>}
        {ev.kind === "historique" ? (
          <p className="t-14" style={{ marginTop: 16 }}>
            <Link to={eventPath(ev.id)}>Les vues heure par heure, en trois langues →</Link>
          </p>
        ) : (
          <LeadTexts ev={ev} />
        )}
      </div>
      <div>
        {ev.thumbnail_url ? (
          <WikiImage eager url={ev.thumbnail_url} lang={img?.lang} title={img?.title} alt={ev.title} width={960} />
        ) : !chart && hasSpark ? (
          <SparkColumns ev={ev} />
        ) : null}
      </div>
    </article>
  );
}

/** lead_eligible from the API; when the field is absent (API before v2.1), the same rule as CONTRACT §5.9. */
export function isLeadEligible(ev: EventSummary): boolean {
  if (typeof ev.lead_eligible === "boolean") return ev.lead_eligible;
  if (ev.kind === "historique") return true;
  const strong = ev.distinct_users >= 6 || ev.langs.length >= 2 || ev.total_edits >= 15;
  return strong && (ev.theme !== "autres" || ev.distinct_users >= 10);
}
