import { setFeedStatus, setRefTime } from "./lib/clock";

// Typed client for the Radar API (docs/CONTRACT.md §7). All endpoints are GET + JSON.

export type Lang = "ar" | "fr" | "en";
export type BaselineType = "article" | "provisoire";
export type CollectionName =
  | "edits"
  | "edit_texts"
  | "pageviews"
  | "articles"
  | "wikidata_entities"
  | "events"
  | "alerts"
  | "scores"
  | "ingestion_log";
export type DataKind = "semi-structured" | "unstructured" | "structured" | "derived" | "system";
export type ThemeId =
  | "catastrophes"
  | "conflits"
  | "politique"
  | "sport"
  | "personnalites"
  | "culture"
  | "science"
  | "economie"
  | "sante"
  | "autres";
export type ThemeSource = "wikidata" | "catégories" | "mots-clés" | "inconnu";
export type EventStatus = "en cours" | "terminé" | "historique";

/** theme + theme_label on list items (null when the article is not enriched yet). */
export interface Themed {
  theme?: ThemeId | null;
  theme_label?: string | null;
}

export interface Health {
  status: string;
  mongo: boolean;
  time: string;
}

export interface CollectionStats {
  count: number;
  size_bytes: number;
  avg_doc_bytes: number;
}

export interface Stats {
  time: string;
  /** Latest event time (reference clock for relative times). */
  ref_time?: string | null;
  server_time?: string | null;
  clock_skew_seconds?: number | null;
  collections: Partial<Record<CollectionName, CollectionStats>>;
  db: {
    data_size_bytes: number;
    storage_size_bytes: number;
    index_size_bytes: number;
    total_size_bytes: number;
  };
  edits_per_lang: { lang: Lang; count: number }[];
  edits_last_minute: number;
  edits_last_hour: number;
  bots: { bot: number; human: number; bot_pct: number };
  ingestion_rate_per_min: number;
  active_articles: number;
  active_alerts: number;
  first_edit_at: string | null;
  last_edit_at: string | null;
  pageviews_hours_loaded: number;
}

export interface Edit extends Themed {
  id: string;
  title: string;
  lang: Lang;
  user: string;
  bot: boolean;
  type: "edit" | "new";
  timestamp: string;
  comment: string;
  delta_bytes: number;
  url: string;
}

export interface TopEdit extends Themed {
  lang: Lang;
  title: string;
  edits: number;
  distinct_users: number;
  delta_bytes: number;
  last_edit: string;
}

export interface TimelinePoint {
  t: string;
  ar: number;
  fr: number;
  en: number;
  total: number;
}

export interface Timeline {
  minutes: number;
  bucket_seconds: number;
  items: TimelinePoint[];
}

export interface RadarItem extends Themed {
  lang: Lang;
  title: string;
  edits: number;
  distinct_users: number;
  delta_bytes: number;
  last_edit: string;
  z_score: number | null;
  baseline_type: BaselineType | null;
  alert: boolean;
}

export interface Radar {
  window_minutes: number;
  /** = ref_time (latest event time). */
  time: string;
  items: RadarItem[];
}

export interface Alert extends Themed {
  id: string;
  lang: Lang;
  title: string;
  window_start: string;
  window_end: string;
  edits: number;
  distinct_users: number;
  delta_bytes: number;
  baseline_mean: number;
  baseline_std: number;
  baseline_type: BaselineType;
  z_score: number;
  created_at: string;
}

export interface EditText {
  id: string;
  rev_new: number;
  timestamp: string;
  comment: string;
  added_text: string;
  removed_text: string;
}

export interface Article {
  lang: Lang;
  title: string;
  url: string;
  stats: {
    edits_total: number;
    edits_human: number;
    distinct_users: number;
    first_edit: string | null;
    last_edit: string | null;
    delta_bytes: number;
  };
  timeline: { t: string; edits: number }[];
  edits: Edit[];
  texts: EditText[];
  alerts: Alert[];
  pageviews_count: number;
  enrichment?: Enrichment | null;
  events?: EventSummary[];
}

export interface Enrichment {
  qid: string | null;
  description: string | null;
  /** French Wikidata description, when it exists. */
  description_fr?: string | null;
  thumbnail_url: string | null;
  categories: string[];
  instance_of: { qid: string; label: string | null }[];
  occupations: { qid: string; label: string | null }[];
  death_date: string | null;
  theme: ThemeId | null;
  theme_label: string | null;
  theme_source: ThemeSource | null;
  theme_confidence: number | null;
  theme_reason: string | null;
  enriched_at: string | null;
  wikidata_url: string | null;
}

export interface EventSummary {
  id: string;
  kind: "detected" | "historique";
  qid: string | null;
  theme: ThemeId;
  theme_label: string;
  title: string;
  titles: Partial<Record<Lang, string>>;
  description: string | null;
  /** Language of `description` ("fr" | "en" | "ar"), when the API knows it. */
  description_lang?: Lang | null;
  thumbnail_url: string | null;
  first_seen: string | null;
  last_activity: string | null;
  peak_z: number | null;
  peak_at: string | null;
  langs: Lang[];
  total_edits: number;
  distinct_users: number;
  alerts_count: number;
  status: EventStatus;
  significance?: number | null;
  lead_eligible?: boolean;
  spark: number[];
}

export interface EventDetail {
  event: EventSummary & {
    articles: { lang: Lang; title: string; url: string; theme: ThemeId | null; theme_source: ThemeSource | null; theme_reason: string | null }[];
    wikidata_url: string | null;
    links: { lang: Lang; title: string; url: string }[];
    peak_views: number | null;
    total_views: number | null;
  };
  bucket_seconds: number;
  timeline: TimelinePoint[];
  texts: { id: string; lang: Lang; title: string; timestamp: string; comment: string | null; added_text: string | null }[];
  pageviews: { lang: Lang; title: string; items: PageviewPoint[] }[];
  alerts: Alert[];
  editors_top: { user: string; edits: number }[];
}

export interface ThemeItem {
  id: ThemeId;
  label: string;
  events: number;
  active_events: number;
  edits_24h: number;
  articles: number;
  trend: number[];
  top_events: EventSummary[];
}

export interface ThemesIndex {
  ref_time: string | null;
  items: ThemeItem[];
}

export interface ThemeDetail {
  id: ThemeId;
  label: string;
  ref_time: string | null;
  events: EventSummary[];
  top_articles: {
    lang: Lang;
    title: string;
    edits_24h: number;
    distinct_users: number;
    qid: string | null;
    description: string | null;
    thumbnail_url: string | null;
    theme_source: ThemeSource | null;
  }[];
  timeline: { t: string; edits: number }[];
  counts: { events: number; active_events: number; edits_24h: number; articles: number };
}

export interface ThemesTimeline {
  hours: number;
  bucket_seconds: number;
  themes: { id: ThemeId; label: string }[];
  items: ({ t: string; non_classe: number } & Partial<Record<ThemeId, number>>)[];
}

export interface Classification {
  total_articles: number;
  candidates: number;
  by_theme: { id: ThemeId; label: string; count: number; pct: number }[];
  by_source: { source: ThemeSource; count: number; pct: number }[];
  by_lang: { lang: Lang; count: number }[];
  with_qid: number;
  with_thumbnail: number;
  last_enriched_at: string | null;
}

export interface FrontPage {
  ref_time: string | null;
  lead: EventSummary | null;
  lead_reason: "48h" | "7j" | "archives" | null;
  sections: { id: ThemeId; label: string; events: EventSummary[] }[];
}

export interface EventsList {
  count: number;
  items: EventSummary[];
}

export interface PageviewPoint {
  hour: string;
  views: number;
}

export interface Pageviews {
  lang: Lang;
  title: string;
  start: string | null;
  end: string | null;
  items: PageviewPoint[];
}

export interface PageviewsTop {
  hour: string | null;
  items: { lang: Lang; title: string; views: number }[];
}

export interface ReplaySeries {
  lang: Lang;
  title: string;
  title_at_time: string;
  titles_counted: string[];
  url: string;
  items: PageviewPoint[];
  peak: PageviewPoint | null;
  total: number;
}

export interface Replay {
  event: { name: string; time: string };
  start: string;
  end: string;
  hours_loaded: number;
  series: ReplaySeries[];
}

export interface SearchResult extends Themed {
  id: string;
  lang: Lang;
  title: string;
  rev_new: number;
  timestamp: string;
  comment: string;
  snippet: string;
  score: number;
}

export interface Search {
  q: string;
  count: number;
  items: SearchResult[];
}

export interface Explorer {
  collection: CollectionName;
  data_kind: DataKind;
  count: number;
  size_bytes: number;
  avg_doc_bytes: number;
  fields: string[];
  indexes: { name: string; key: Record<string, unknown> }[];
  skip: number;
  limit: number;
  docs: Record<string, unknown>[];
}

/** Error thrown for non-2xx answers or network failures. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, params?: Params): string {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
  }
  const s = qs.toString();
  return `/api${path}${s ? `?${s}` : ""}`;
}

async function get<T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, params), { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Impossible de joindre l’API (réseau).");
  }
  if (!res.ok) {
    let detail = `Erreur HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      /* body is not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

/** Filters shared by the live endpoints. */
export interface LiveFilters {
  lang?: Lang | null;
  includeBots?: boolean;
}

const enc = encodeURIComponent;

export const api = {
  health: (signal?: AbortSignal) => get<Health>("/health", undefined, signal),
  stats: (signal?: AbortSignal) =>
    get<Stats>("/stats", undefined, signal).then((d) => {
      setRefTime(d.ref_time);
      setFeedStatus(d.ref_time, d.ingestion_rate_per_min);
      return d;
    }),

  recentEdits: (f: LiveFilters & { limit?: number }, signal?: AbortSignal) =>
    get<{ items: Edit[]; ref_time?: string | null }>(
      "/edits/recent",
      { lang: f.lang, include_bots: !!f.includeBots, limit: f.limit ?? 50 },
      signal,
    ).then((d) => {
      setRefTime(d.ref_time);
      return d;
    }),

  topEdits: (f: LiveFilters & { minutes?: number; limit?: number }, signal?: AbortSignal) =>
    get<{ minutes: number; items: TopEdit[] }>(
      "/edits/top",
      { minutes: f.minutes ?? 60, lang: f.lang, include_bots: !!f.includeBots, limit: f.limit ?? 20 },
      signal,
    ),

  timeline: (f: LiveFilters & { minutes?: number }, signal?: AbortSignal) =>
    get<Timeline>("/edits/timeline", { minutes: f.minutes ?? 60, lang: f.lang, include_bots: !!f.includeBots }, signal),

  radar: (f: LiveFilters, signal?: AbortSignal) =>
    get<Radar>("/radar", { lang: f.lang, include_bots: !!f.includeBots }, signal).then((d) => {
      setRefTime(d.time);
      return d;
    }),

  alerts: (f: { lang?: Lang | null; limit?: number }, signal?: AbortSignal) =>
    get<{ items: Alert[] }>("/alerts", { lang: f.lang, limit: f.limit ?? 50 }, signal),

  article: (lang: Lang, title: string, signal?: AbortSignal) =>
    get<Article>(`/articles/${lang}/${enc(title)}`, undefined, signal),

  pageviews: (lang: Lang, title: string, range?: { start?: string; end?: string }, signal?: AbortSignal) =>
    get<Pageviews>(`/pageviews/${lang}/${enc(title)}`, { start: range?.start, end: range?.end }, signal),

  pageviewsTop: (f: { hour?: string; lang?: Lang | null; limit?: number }, signal?: AbortSignal) =>
    get<PageviewsTop>("/pageviews/top", { hour: f.hour, lang: f.lang, limit: f.limit ?? 20 }, signal),

  replayAlHaouz: (signal?: AbortSignal) => get<Replay>("/replay/alhaouz", undefined, signal),

  search: (q: string, f: { lang?: Lang | null; theme?: ThemeId | null; limit?: number }, signal?: AbortSignal) =>
    get<Search>("/search", { q, lang: f.lang, theme: f.theme, limit: f.limit ?? 20 }, signal),

  frontpage: (signal?: AbortSignal) =>
    get<FrontPage>("/frontpage", undefined, signal).then((d) => {
      setRefTime(d.ref_time);
      return d;
    }),
  themes: (signal?: AbortSignal) =>
    get<ThemesIndex>("/themes", undefined, signal).then((d) => {
      setRefTime(d.ref_time);
      return d;
    }),
  theme: (id: string, signal?: AbortSignal) =>
    get<ThemeDetail>(`/themes/${enc(id)}`, undefined, signal).then((d) => {
      setRefTime(d.ref_time);
      return d;
    }),
  themesTimeline: (hours: number, signal?: AbortSignal) => get<ThemesTimeline>("/themes/timeline", { hours }, signal),
  classification: (signal?: AbortSignal) => get<Classification>("/themes/classification", undefined, signal),
  events: (
    f: { theme?: ThemeId | null; status?: EventStatus | null; kind?: string | null; sort?: "recent" | "peak" | "significance"; lead?: boolean; limit?: number },
    signal?: AbortSignal,
  ) =>
    get<EventsList>(
      "/events",
      { theme: f.theme, status: f.status, kind: f.kind, sort: f.sort, lead: f.lead ? "true" : undefined, limit: f.limit ?? 20 },
      signal,
    ),
  event: (id: string, signal?: AbortSignal) => get<EventDetail>(`/events/${enc(id)}`, undefined, signal),

  explorer: (collection: CollectionName, p: { limit?: number; skip?: number }, signal?: AbortSignal) =>
    get<Explorer>(`/explorer/${collection}`, { limit: p.limit ?? 20, skip: p.skip ?? 0 }, signal),
};
