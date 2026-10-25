import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EventSummary, Lang } from "../api";
import { fmtDay, fmtInt, fmtZ, plural } from "../lib/format";
import { LANG_NAME, LANG_ORDER } from "../lib/lang";
import { eventPath } from "../lib/themes";
import { WikiImage } from "./blocks";
import { ChartFrame, ColumnChart, Sparkline } from "./charts";
import { fmtTimeUtc } from "../lib/format";
import { Kicker, LangList, MetaLine, StatusLabel, Timestamp } from "./text";

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

/** Factual standfirst when there is no Wikidata description. */
export function eventStandfirst(ev: EventSummary): string {
  if (ev.description) return ev.description.charAt(0).toUpperCase() + ev.description.slice(1);
  if (ev.kind === "historique") return "Événement historique reconstitué à partir des vues horaires Wikipédia.";
  const langs = ev.langs.length ? ` sur Wikipédia en ${langNames(ev.langs)}` : "";
  return `${plural(ev.total_edits, "modification")} par ${plural(ev.distinct_users, "contributeur")}${langs}.`;
}

function sparkLabel(ev: EventSummary): string {
  const max = Math.max(0, ...ev.spark);
  const last = ev.spark[ev.spark.length - 1] ?? 0;
  return `Modifications par heure sur 24 h : maximum ${fmtInt(max)}, dernière heure ${fmtInt(last)}.`;
}

export function eventMeta(ev: EventSummary, opts: { short?: boolean } = {}): ReactNode[] {
  if (ev.kind === "historique") {
    return [ev.langs.length ? <LangList langs={ev.langs} /> : null, ev.first_seen ? fmtDay(ev.first_seen) : null, "vues horaires Wikipédia"];
  }
  return [
    ev.langs.length ? <LangList langs={ev.langs} /> : null,
    <Timestamp iso={ev.last_activity} />,
    opts.short ? null : plural(ev.distinct_users, "contributeur"),
    opts.short ? null : plural(ev.total_edits, "modification"),
  ];
}

function Headline({ ev, className }: { ev: EventSummary; className: string }) {
  const l = titleLang(ev);
  return (
    <h3 className={className}>
      <Link to={eventPath(ev.id)} className="hl" dir={l === "ar" ? "rtl" : undefined} lang={l}>
        {ev.title}
      </Link>
    </h3>
  );
}

/** Standard item: optional photo, 20px headline, one-line description, meta line, sparkline. */
export function EventStandard({ ev, showKicker = false }: { ev: EventSummary; showKicker?: boolean }) {
  const img = imageLang(ev);
  const live = ev.status === "en cours";
  return (
    <article className="ev-std">
      <WikiImage url={ev.thumbnail_url} lang={img?.lang} title={img?.title} alt={ev.title} />
      {showKicker ? <Kicker theme={ev.theme} label={ev.theme_label} live={live && ev.alerts_count > 0} /> : <p className="kicker"><StatusLabel status={ev.status} /></p>}
      <Headline ev={ev} className="t-20" />
      <p className="ev-desc">{eventStandfirst(ev)}</p>
      <div className="ev-foot">
        <MetaLine items={eventMeta(ev, { short: true })} />
        {ev.kind !== "historique" && ev.spark.some((v) => v > 0) && <Sparkline values={ev.spark} alert={live} label={sparkLabel(ev)} />}
      </div>
    </article>
  );
}

/** Compact item: 16px headline + meta, for dense lists. */
export function EventCompact({ ev, showTheme = false }: { ev: EventSummary; showTheme?: boolean }) {
  return (
    <li className="ev-compact">
      <Headline ev={ev} className="h-16" />
      <MetaLine
        items={[
          showTheme ? ev.theme_label : null,
          ev.status === "en cours" ? <StatusLabel status={ev.status} /> : null,
          ...eventMeta(ev, { short: true }),
          ev.peak_z !== null && ev.kind !== "historique" ? `z max ${fmtZ(ev.peak_z)}` : null,
        ]}
      />
    </li>
  );
}

/** Lead item (7/5 split): kicker, big headline, standfirst, meta, small chart; photo in the right 5 columns. */
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
  const live = ev.status === "en cours";
  const l = titleLang(ev);
  const H = as;
  const hasSpark = ev.kind !== "historique" && ev.spark.some((v) => v > 0);
  return (
    <article className="ev-lead split-lead">
      <div>
        <Kicker
          theme={ev.theme}
          label={ev.theme_label}
          live={live && ev.alerts_count > 0}
          extra={
            <>
              <StatusLabel status={ev.status} />
              {kickerExtra}
            </>
          }
        />
        <H className={size}>
          <Link to={eventPath(ev.id)} className="hl" dir={l === "ar" ? "rtl" : undefined} lang={l}>
            {ev.title}
          </Link>
        </H>
        <p className="standfirst">{eventStandfirst(ev)}</p>
        <MetaLine items={eventMeta(ev)} />
        {chart && <div className="ev-lead-chart">{chart}</div>}
        {!chart && ev.kind === "historique" && (
          <p className="t-14" style={{ marginTop: 16 }}>
            <Link to={eventPath(ev.id)}>Les vues heure par heure, en trois langues →</Link>
          </p>
        )}
        {!chart && ev.thumbnail_url && hasSpark && (
          <div className="ev-lead-chart">
            <Sparkline values={ev.spark} width={160} height={32} alert={live} label={sparkLabel(ev)} />
            <p className="source">Modifications humaines par heure, 24 heures.</p>
          </div>
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

/** The event's 24 hourly values as a framed column chart (used when the lead has no photo). */
function SparkColumns({ ev }: { ev: EventSummary }) {
  const HOUR = 3600 * 1000;
  const end = ev.last_activity ? Math.floor(new Date(ev.last_activity).getTime() / HOUR) * HOUR : 0;
  const xs = ev.spark.map((_, i) => end - (ev.spark.length - 1 - i) * HOUR);
  const total = ev.spark.reduce((a, v) => a + v, 0);
  return (
    <ChartFrame
      title={`Modifications humaines par heure, 24 heures jusqu’à ${fmtTimeUtc(end + HOUR)}`}
      source={<p className="source">Source : collection <code>edits</code> (MongoDB), articles de l’événement.</p>}
    >
      <ColumnChart
        xs={xs}
        values={ev.spark}
        bucketMs={HOUR}
        height={220}
        xTickEvery={6}
        xFormat={(t) => fmtTimeUtc(t).replace(" UTC", "")}
        tipTitle={(t) => `${fmtTimeUtc(t).replace(" UTC", "")}–${fmtTimeUtc(t + HOUR)}`}
        unit="modifications"
        highlight={ev.status === "en cours" ? (i) => i === ev.spark.length - 1 : undefined}
        ariaLabel={`${fmtInt(total)} modifications sur 24 heures.`}
      />
    </ChartFrame>
  );
}
