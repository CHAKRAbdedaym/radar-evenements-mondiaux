# CONTRACT — Radar d'événements mondiaux

> Single source of truth for every subagent. Owned by the orchestrator. **Do not change it yourself**: report needed changes.
> Version 1.2

## 1. Repository layout

```
.
├── docker-compose.yml
├── .env.example            # all variables, documented (copy to .env)
├── mongo/init/01-init.js   # creates collections + ALL indexes (runs on first start)
├── ingestion/              # Python 3.11 services (one image, several commands)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── radar_ingest/
│   │   ├── common.py       # env config, mongo client, logging, http session with User-Agent
│   │   ├── streamer.py     # edits-streamer
│   │   ├── diff_worker.py  # diff-worker
│   │   ├── pageviews.py    # pageviews-loader (CLI)
│   │   └── detector.py     # detector
│   └── config/watchlist.json
├── backend/                # FastAPI + motor
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/ (main.py, db.py, routers/…, replay.py)
├── frontend/               # React + Vite + TS + Tailwind + Recharts, nginx
│   ├── Dockerfile
│   └── nginx.conf
├── qa/                     # Playwright scripts + screenshots/
└── docs/CONTRACT.md
```

## 2. Docker services (compose project name: `radar`)

| service | image / build | port (host) | notes |
|---|---|---|---|
| `mongo` | `mongo:7` | `127.0.0.1:${MONGO_PORT}:27017` | named volume `mongo-data`, healthcheck `mongosh --eval "db.adminCommand('ping')"`, init script mounted read-only `:ro,Z` into `/docker-entrypoint-initdb.d`. **No auth** (bound to localhost only, internal network) so `docker compose exec mongo mongosh radar` works. |
| `mongo-express` | `mongo-express:1.0.2` | `${ME_PORT}:8081` | basic auth `ME_USER` / `ME_PASSWORD` |
| `edits-streamer` | build `./ingestion`, cmd `python -m radar_ingest.streamer` | – | restart unless-stopped |
| `diff-worker` | build `./ingestion`, cmd `python -m radar_ingest.diff_worker` | – | restart unless-stopped |
| `detector` | build `./ingestion`, cmd `python -m radar_ingest.detector` | – | restart unless-stopped |
| `pageviews-loader` | build `./ingestion`, entrypoint `python -m radar_ingest.pageviews` | – | profile `batch`, one-shot |
| `backend` | build `./backend` (uvicorn) | `${API_PORT}:8000` | healthcheck on `/api/health` |
| `frontend` | build `./frontend` (multi-stage → nginx) | `${APP_PORT}:5173` | nginx listens 5173, proxies `/api/` → `http://backend:8000/api/` |
| `qa` | `mcr.microsoft.com/playwright/python:v1.48.0-jammy` | – | profile `qa`, mounts `./qa:/qa:Z`, network access to `frontend:5173` |

All app services: `depends_on: mongo: condition: service_healthy`; frontend depends on backend healthy.
Pageviews command: `docker compose --profile batch run --rm pageviews-loader --start 2023-09-08T12 --end 2023-09-10T12`

## 3. Environment variables (`.env`, documented in `.env.example`)

| name | default | used by |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `radar` | compose |
| `MONGO_PORT` | `27017` | compose |
| `ME_PORT` | `8081` | compose |
| `API_PORT` | `8000` | compose |
| `APP_PORT` | `5173` | compose |
| `ME_USER` / `ME_PASSWORD` | `admin` / (set) | mongo-express |
| `MONGO_URI` | `mongodb://mongo:27017` | all python services |
| `MONGO_DB` | `radar` | all python services |
| `WIKI_USER_AGENT` | `RadarEvenements/0.1 (projet etudiant FST Marrakech; contact: <email>)` | every Wikimedia request |
| `WIKIS` | `arwiki,frwiki,enwiki` | streamer |
| `STREAM_URL` | `https://stream.wikimedia.org/v2/stream/recentchange` | streamer |
| `STREAM_BATCH_SIZE` | `100` | streamer (flush when reached) |
| `STREAM_FLUSH_SECONDS` | `2` | streamer (flush at least every N s) |
| `DIFF_RATE_PER_SEC` | `5` | diff-worker |
| `DIFF_QUEUE_MAX` | `2000` | diff-worker |
| `DIFF_LOOKBACK_MINUTES` | `30` | diff-worker (on start, only consider edits this recent) |
| `PAGEVIEWS_MIN_VIEWS` | `20` (medium demo dataset, ~100k rows/hour; 1 = full scale) | loader: keep a merged (lang,title,hour) row only if views ≥ this, **except watchlist titles which are always kept** |
| `PAGEVIEWS_BULK_SIZE` | `5000` | loader |
| `PAGEVIEWS_PARALLEL` | `2` | loader (max 2: Wikimedia limit) |
| `DETECTOR_INTERVAL_SECONDS` | `60` | detector |
| `WINDOW_MINUTES` | `5` | detector, API radar |
| `BASELINE_HOURS` | `24` | detector |
| `MIN_HISTORY_HOURS` | `6` | detector |
| `Z_THRESHOLD` | `3` | detector |
| `MIN_USERS` | `3` | detector |
| `ALERT_COOLDOWN_MINUTES` | `15` | detector |

## 4. Conventions (everyone)

- **lang** ∈ `"ar" | "fr" | "en"`; **wiki** ∈ `"arwiki" | "frwiki" | "enwiki"`.
- **title**: canonical display form, **spaces not underscores** (`"Séisme de 2023 au Maroc"`). The pageviews loader converts `_` → space. The API accepts both and normalizes `_` → space.
- All dates stored as BSON `Date` in UTC. API returns ISO-8601 strings with `Z` (e.g. `"2023-09-08T22:00:00Z"`).
- Wikipedia URL: `https://{lang}.wikipedia.org/wiki/{title with _ , URL-encoded}`.
- Article API path: `/api/articles/{lang}/{title}` — title URL-encoded (`encodeURIComponent`); titles may contain `/`, so the route uses `{title:path}`.

## 4b. Time reference (v1.2)
The host clock may be wrong (measured 1 h behind real UTC). Wikimedia event timestamps are correct, so the system uses **event time**: `ref_time = max(edits.timestamp)`. The detector window is `[ref_time − WINDOW_MINUTES, ref_time]`; every API "last N minutes" window on `timestamp` is relative to `ref_time`; alert activity compares `alerts.window_end` with `ref_time`. Processing-time fields (`ingested_at`, `created_at`, `computed_at`, `fetched_at`) use the container wall clock and are only compared with each other. `/api/stats` adds `ref_time`, `server_time`, `clock_skew_seconds`; `/api/edits/recent` adds top-level `ref_time`; `/api/radar.time` = `ref_time`. The UI computes relative times against `ref_time`.

## 5. MongoDB — database `radar`

### 5.1 `edits` (semi-structured JSON, from EventStreams)
```json
{
  "_id": "a3f5c1e2-…",            // meta.id of the event (string, uuid)
  "title": "Séisme de 2023 au Maroc",
  "lang": "fr", "wiki": "frwiki",
  "user": "Exemple", "bot": false,
  "type": "edit",                  // "edit" | "new"
  "timestamp": ISODate("2026-10-15T18:40:12Z"),   // event 'timestamp' (unix s) → Date
  "comment": "ajout bilan",
  "rev_old": 123456, "rev_new": 123457,           // revision.old may be null for type "new"
  "length_old": 1200, "length_new": 1350,         // length.old may be null
  "delta_bytes": 150,                              // length_new - (length_old or 0)
  "url": "https://fr.wikipedia.org/wiki/S%C3%A9isme_de_2023_au_Maroc",
  "ingested_at": ISODate("2026-10-15T18:40:13Z")
}
```
Filter: `wiki ∈ WIKIS`, `type ∈ {edit,new}`, `namespace == 0`. Upsert by `_id`.
Indexes: `{timestamp:-1}`, `{lang:1,title:1,timestamp:-1}`, `{bot:1,timestamp:-1}`, `{ingested_at:-1}`.

### 5.2 `edit_texts` (unstructured text, from action=compare)
```json
{
  "_id": "fr:123457",              // "{lang}:{rev_new}" (rev ids are only unique per wiki)
  "rev_new": 123457, "rev_old": 123456,
  "lang": "fr", "title": "Séisme de 2023 au Maroc",
  "added_text": "Le bilan s'élève à …",     // plain text, HTML stripped, lines joined by "\n"
  "removed_text": "…",
  "comment": "ajout bilan",
  "timestamp": ISODate("…"),       // edit timestamp
  "fetched_at": ISODate("…")
}
```
Only non-bot edits. Indexes: text index `{added_text:"text", comment:"text"}` with `default_language:"none"` (name `text_search`), `{timestamp:-1}`, `{lang:1,title:1,timestamp:-1}`.

### 5.3 `pageviews` (structured table, from hourly dumps)
```json
{ "lang": "fr", "title": "Séisme de 2023 au Maroc", "hour": ISODate("2023-09-08T22:00:00Z"), "views": 1234 }
```
`views` = desktop + mobile (`fr` + `fr.m`) for that title and hour. Upsert key `(lang,title,hour)` with `$set views` (idempotent).
Indexes: unique `{lang:1,title:1,hour:1}`, `{hour:1,views:-1}`.

### 5.4 `alerts`
```json
{
  "_id": ObjectId,
  "lang": "en", "title": "…",
  "window_start": ISODate, "window_end": ISODate,
  "edits": 9, "distinct_users": 5, "delta_bytes": 4210,
  "baseline_mean": 0.12, "baseline_std": 0.4,
  "baseline_type": "article",      // "article" | "provisoire"
  "z_score": 22.2,
  "created_at": ISODate
}
```
Indexes: `{created_at:-1}`, `{lang:1,title:1,created_at:-1}`, `{z_score:-1}`.

### 5.5 `scores` (latest detector score per active article — feeds the radar "z if known")
```json
{ "_id": "en:Title", "lang": "en", "title": "Title", "z_score": 1.7, "edits": 3, "distinct_users": 2,
  "baseline_mean": 0.3, "baseline_std": 0.9, "baseline_type": "article", "computed_at": ISODate }
```
Indexes: TTL `{computed_at:1}` expireAfterSeconds 3600.

### 5.6 `ingestion_log` (loader progress + service checkpoints)
```json
{ "_id": "pageviews:2023-09-08T22", "source": "pageviews", "hour": ISODate("2023-09-08T22:00:00Z"),
  "status": "done",                // "running" | "done" | "error"
  "url": "https://dumps.wikimedia.org/…", "bytes": 60562915,
  "lines_read": 7188874, "lines_kept": 3100000, "rows_written": 424282,
  "min_views": 5, "started_at": ISODate, "finished_at": ISODate, "duration_s": 95.2, "error": null }
{ "_id": "edits-streamer", "source": "edits-streamer", "last_event_id": "<raw Last-Event-ID json string>",
  "events_written": 12345, "updated_at": ISODate }
{ "_id": "diff-worker", "source": "diff-worker", "fetched": 1200, "errors": 3, "queue_size": 40, "updated_at": ISODate }
{ "_id": "detector", "source": "detector", "last_run_at": ISODate, "articles_scored": 120, "alerts_created": 1, "history_hours": 2.5, "updated_at": ISODate }
```
Indexes: `{source:1,hour:1}`.

## 6. Service behaviour

**edits-streamer**: SSE client on `STREAM_URL` with `User-Agent`. Filter (5.1). Batch `bulk_write` of `UpdateOne(upsert)` every `STREAM_BATCH_SIZE` events or `STREAM_FLUSH_SECONDS`. Persist last event id in `ingestion_log` ("edits-streamer") after each flush; on (re)connect send `Last-Event-ID`. Exponential backoff 1 s → 60 s on errors; honor `Retry-After`. Log a line every 30 s: events seen/kept/written, rate.

**diff-worker**: polls `edits` (by `ingested_at` cursor, every 2 s) for non-bot edits with `rev_old` and `rev_new` not yet in `edit_texts`. Bounded priority queue (`DIFF_QUEUE_MAX`): priority 0 = ar & fr, 1 = en articles currently on the radar (≥2 non-bot edits in last `WINDOW_MINUTES`), 2 = other en. When full, drop lowest priority/oldest. Calls `https://{lang}.wikipedia.org/w/api.php?action=compare&fromrev={old}&torev={new}&format=json&formatversion=2` at ≤ `DIFF_RATE_PER_SEC`. Parse the diff table HTML: added text = `td.diff-addedline` + `ins.diffchange` inside changed lines, removed = `td.diff-deletedline` + `del.diffchange`; strip HTML → plain text. Errors (missing rev, 4xx) → log + skip. 429 → sleep `Retry-After`.

**pageviews-loader** CLI: `--start YYYY-MM-DDTHH --end YYYY-MM-DDTHH` (inclusive, UTC; defaults 2023-09-08T12 → 2023-09-10T12), `--force` to redo done hours, `--min-views N`. Skips hours with `status:"done"`. Streams the HTTP response through gzip line by line (never whole file in memory/disk), keeps domain codes `ar, fr, en, ar.m, fr.m, en.m`, merges per (lang,title) within the hour (dict in memory for one hour is OK), filters `views >= MIN_VIEWS` OR title in watchlist, bulk upserts by 5,000, ≤ 2 hours in parallel. Prints progress: hour, MB downloaded, lines read/kept, rows written, elapsed.

**detector** (every `DETECTOR_INTERVAL_SECONDS`): `now`; window = [now−5 min, now). For each (lang,title) with non-bot edits in window: `edits`, `distinct_users`, `delta_bytes` (sum).
History available `H = window_start − max(window_start − BASELINE_HOURS, first non-bot edit timestamp in db)`.
- If `H ≥ MIN_HISTORY_HOURS`: `baseline_type="article"`; `n = floor(H / 5 min)` buckets; counts of that article's non-bot edits per 5-min bucket in [window_start − H, window_start) (missing buckets = 0); `mean = Σc/n`, `std = sqrt(Σc²/n − mean²)`.
- Else: `baseline_type="provisoire"`; collect all non-zero per-(article, 5-min bucket) counts over the available history (non-bot), `mean = median`, `std = population std` of those counts.
`z = (edits − mean) / max(std, 1)`. Upsert `scores`. Alert if `z > Z_THRESHOLD` AND `distinct_users ≥ MIN_USERS` AND no alert for same (lang,title) with `created_at` in the last `ALERT_COOLDOWN_MINUTES`.

## 7. API (FastAPI, prefix `/api`, all GET, JSON)

Errors: `{"detail": "message"}` with 400 (bad param), 404 (unknown collection / article with no data). Dates ISO-8601 `Z`. `lang` param optional, ∈ ar|fr|en (else 400).

### `GET /api/health`
```json
{"status": "ok", "mongo": true, "time": "2026-10-15T18:40:00Z"}
```

### `GET /api/stats`
```json
{
  "time": "2026-10-15T18:40:00Z",
  "collections": {
    "edits": {"count": 120345, "size_bytes": 50331648, "avg_doc_bytes": 418},
    "edit_texts": {"count": 9000, "size_bytes": 1, "avg_doc_bytes": 1},
    "pageviews": {"count": 20000000, "size_bytes": 1, "avg_doc_bytes": 1},
    "alerts": {"count": 12, "size_bytes": 1, "avg_doc_bytes": 1},
    "ingestion_log": {"count": 52, "size_bytes": 1, "avg_doc_bytes": 1}
  },
  "db": {"data_size_bytes": 1, "storage_size_bytes": 1, "index_size_bytes": 1, "total_size_bytes": 1},
  "edits_per_lang": [{"lang": "en", "count": 90000}, {"lang": "fr", "count": 20000}, {"lang": "ar", "count": 5000}],
  "edits_last_minute": 140,
  "edits_last_hour": 8200,
  "bots": {"bot": 1200, "human": 7000, "bot_pct": 14.6},      // over the last hour
  "ingestion_rate_per_min": 150,                                  // docs with ingested_at in last 60 s
  "active_articles": 310,                                         // distinct (lang,title) non-bot, last WINDOW_MINUTES
  "active_alerts": 2,                                             // alerts created in last 60 min
  "first_edit_at": "…", "last_edit_at": "…",
  "pageviews_hours_loaded": 49
}
```

### `GET /api/edits/recent?lang=&include_bots=false&limit=50` (limit ≤ 200)
```json
{"items": [{"id": "uuid", "title": "…", "lang": "fr", "user": "…", "bot": false, "type": "edit",
            "timestamp": "…", "comment": "…", "delta_bytes": 150, "url": "…"}]}
```

### `GET /api/edits/top?minutes=60&lang=&include_bots=false&limit=20` (minutes 1..1440, limit ≤ 100)
```json
{"minutes": 60, "items": [{"lang": "en", "title": "…", "edits": 25, "distinct_users": 7, "delta_bytes": 5400, "last_edit": "…"}]}
```
Sorted by edits desc, then distinct_users desc.

### `GET /api/edits/timeline?minutes=60&lang=&include_bots=false`
Bucket = 1 min if minutes ≤ 180, 5 min if ≤ 1440. Empty buckets filled with 0.
```json
{"minutes": 60, "bucket_seconds": 60,
 "items": [{"t": "2026-10-15T18:00:00Z", "ar": 2, "fr": 10, "en": 95, "total": 107}]}
```

### `GET /api/radar?lang=&include_bots=false`
Articles active in the last `WINDOW_MINUTES` (max 150, sorted by edits desc).
```json
{"window_minutes": 5, "time": "…",
 "items": [{"lang": "en", "title": "…", "edits": 6, "distinct_users": 4, "delta_bytes": 2100,
            "last_edit": "…", "z_score": 4.2, "baseline_type": "article", "alert": true}]}
```
`z_score`/`baseline_type` from `scores` (null if not scored yet); `alert` = alert for that article created within last `ALERT_COOLDOWN_MINUTES`.

### `GET /api/alerts?limit=50&lang=` (sorted by created_at desc; frontend may sort by z)
```json
{"items": [{"id": "65f…", "lang": "en", "title": "…", "window_start": "…", "window_end": "…",
            "edits": 9, "distinct_users": 5, "delta_bytes": 4210, "baseline_mean": 0.12,
            "baseline_std": 0.4, "baseline_type": "article", "z_score": 22.2, "created_at": "…"}]}
```

### `GET /api/articles/{lang}/{title}`
404 only if the article has no edits, no edit_texts and no pageviews.
```json
{"lang": "fr", "title": "…", "url": "https://fr.wikipedia.org/wiki/…",
 "stats": {"edits_total": 40, "edits_human": 35, "distinct_users": 12, "first_edit": "…", "last_edit": "…", "delta_bytes": 9000},
 "timeline": [{"t": "…", "edits": 3}],          // 5-min buckets, non-empty only, last 24 h of this article's edits
 "edits": [ /* same shape as edits/recent items, latest 100 */ ],
 "texts": [{"id": "fr:123457", "rev_new": 123457, "timestamp": "…", "comment": "…", "added_text": "…", "removed_text": "…"}],  // latest 30
 "alerts": [ /* same shape as /api/alerts items */ ],
 "pageviews_count": 49}
```

### `GET /api/pageviews/{lang}/{title}?start=2023-09-08T12&end=2023-09-10T12`
start/end optional (`YYYY-MM-DDTHH` or full ISO). Sorted by hour.
```json
{"lang": "fr", "title": "…", "start": "…", "end": "…", "items": [{"hour": "2023-09-08T22:00:00Z", "views": 1234}]}
```

### `GET /api/pageviews/top?hour=2023-09-08T22&lang=&limit=20`
Default hour = latest hour loaded. Excludes main pages (`Main Page`, `Wikipédia:Accueil principal`, `الصفحة الرئيسية`), `-`, and titles starting with `Special:`, `Spécial:`, `خاص:`.
```json
{"hour": "2023-09-08T22:00:00Z", "items": [{"lang": "en", "title": "…", "views": 50000}]}
```

### `GET /api/replay/alhaouz`
Series for the replay page. Titles are defined in `backend/app/replay.py` (confirmed with the MediaWiki API):

| lang | display title (today) | title used on 2023-09-08..10 | titles counted (= `ingestion/config/watchlist.json[lang]`) |
|---|---|---|---|
| ar | زلزال الحوز 2023 | زلزال مراكش-آسفي 2023 | all ar watchlist titles |
| fr | Séisme de 2023 au Maroc | Séisme de 2023 au Maroc | all fr watchlist titles |
| en | 2023 Al Haouz earthquake | 2023 Marrakesh-Safi earthquake | all en watchlist titles |

Each series also returns `"title_at_time"`. Per language, views = sum over the article title **and its redirect titles listed in replay.py** (views of a redirect are counted under the redirect's name in the dumps). Hours with no row → 0 only if that hour is loaded (`ingestion_log` done), otherwise omitted.
```json
{"event": {"name": "Séisme d'Al Haouz", "time": "2023-09-08T22:11:00Z"},
 "start": "2023-09-08T12:00:00Z", "end": "2023-09-10T12:00:00Z",
 "hours_loaded": 49,
 "series": [{"lang": "ar", "title": "زلزال الحوز 2023", "titles_counted": ["…"], "url": "…",
             "items": [{"hour": "…", "views": 0}], "peak": {"hour": "…", "views": 9999}, "total": 123456}]}
```

### `GET /api/search?q=&lang=&limit=20` (q 2..100 chars, limit ≤ 50)
MongoDB `$text` on `edit_texts`, sorted by textScore.
```json
{"q": "séisme", "count": 3,
 "items": [{"id": "fr:123", "lang": "fr", "title": "…", "rev_new": 123, "timestamp": "…", "comment": "…",
            "snippet": "…texte autour du mot séisme…", "score": 1.2}]}
```
`snippet`: ≤ 240 chars of `added_text` (or comment) around the first match (case-insensitive). Frontend highlights the query terms.

### `GET /api/explorer/{collection}?limit=20&skip=0` (whitelist: edits, edit_texts, pageviews, alerts, ingestion_log, scores; limit ≤ 100)
```json
{"collection": "edits", "data_kind": "semi-structured",   // edits: semi-structured, edit_texts: unstructured, pageviews: structured, others: "system"
 "count": 120345, "size_bytes": 1, "avg_doc_bytes": 418,
 "fields": ["_id", "title", "lang", "…"],                   // union of keys over the returned docs
 "indexes": [{"name": "timestamp_-1", "key": {"timestamp": -1}}],
 "skip": 0, "limit": 20,
 "docs": [ { /* raw document, dates as ISO strings, ObjectId as string */ } ]}
```
Sort: newest first (`timestamp`/`created_at`/`hour`/`_id` desc as relevant).
