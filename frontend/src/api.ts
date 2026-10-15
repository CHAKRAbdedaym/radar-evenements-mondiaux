import { setFeedStatus, setRefTime } from "./lib/clock";

// Typed client for the Radar API (docs/CONTRACT.md §7). All endpoints are GET + JSON.

export type Lang = "ar" | "fr" | "en";
export type BaselineType = "article" | "provisoire";
export type CollectionName = "edits" | "edit_texts" | "pageviews" | "alerts" | "ingestion_log" | "scores";
export type DataKind = "semi-structured" | "unstructured" | "structured" | "system";

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

export interface Edit {
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

export interface TopEdit {
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

export interface RadarItem {
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

export interface Alert {
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

export interface SearchResult {
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
    throw new ApiError(0, "Impossible de joindre l'API (réseau).");
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

  search: (q: string, f: { lang?: Lang | null; limit?: number }, signal?: AbortSignal) =>
    get<Search>("/search", { q, lang: f.lang, limit: f.limit ?? 20 }, signal),

  explorer: (collection: CollectionName, p: { limit?: number; skip?: number }, signal?: AbortSignal) =>
    get<Explorer>(`/explorer/${collection}`, { limit: p.limit ?? 20, skip: p.skip ?? 0 }, signal),
};
