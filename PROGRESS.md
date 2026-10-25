# PROGRESS — Radar d'événements mondiaux

> Updated by the orchestrator after every step. If the session restarts: read this file and continue from "Next".

## Status by step

| # | step | status | proof / notes |
|---|---|---|---|
| 0 | Environment + team + contract | ✅ done | Docker Engine 27.4.1 (server = Docker Engine), Compose v2.32.1, hello-world OK, ports 5173/8000/8081/27017 free, HTTPS 200 on stream/dumps/fr.wikipedia. git init (author CHAKRAbdedaym). 6 subagents in `.claude/agents/`. `docs/CONTRACT.md` v1.0 written. |
| 1 | infra (compose, mongo, mongo-express, init script) | ✅ done | mongo healthy (waits for init), 6 collections + all contract indexes verified, mongo-express 401 without auth / 200 with, both bound to 127.0.0.1. Commit 4997ba5. |
| 2 | edits-streamer | ✅ done | 1,587 real edits after ~15 min (ar 52/12 bot, fr 137/40, en 995/351), Last-Event-ID checkpoint + resume verified, 0 errors, 28 MiB. |
| 3 | diff-worker | ✅ done | 1,155 edit_texts (real wikitext added/removed, ar/fr/en), 0 errors, ≤5 req/s. |
| 4 | pageviews-loader | ✅ done (medium, network-limited) | 10 hours loaded: 2023-09-08 12h–13h + 20h → 2023-09-09 03h = 904,116 rows (≈ 8.5M lines read/hour, ~9 min/hour on the slow link). Real spike: EN 0 → 1,579 views/h at 09-09 00:00, FR 230, AR 225. Remaining hours: same command, done hours are skipped. |
| 5 | detector | ✅ done | event-time window, ~380 articles scored/cycle, 0 alerts yet: history 0.14 h → provisoire baseline (median 1) → needs ≥5 edits by ≥3 users in 5 min. Alert path proven on a throwaway db. Article baseline needs ≥6 h of stream. |
| 6 | backend | ✅ done | all §7 endpoints curl-verified on real data, stats ~6 ms, radar ~14 ms, IXSCAN only, event-time ref (skew 3605 s measured). Replay/pageviews re-check after full load. |
| 7 | frontend + 2 polish rounds | ✅ done | 7 pages, tsc 0 errors, no overflow at 390 px, no console errors. Round 1: mobile radar, label collisions, event-time relative times, bdi for Arabic, consistent counts, slow-feed badge. Round 2: alerts grouped per article, clearer lag wording, replay partial data (EN peak 261 views at 2023-09-08 23:00 UTC, real). Commit 4c0ef9d. |
| 8 | full QA from scratch | ✅ done | qa-verifier: 2,305 API checks OK, indexes/unique keys/no duplicate alerts verified, restarts recover (Last-Event-ID resume), no overflow at 390/1440, no console errors. `docker compose down` + `up -d --build` → all healthy in ~2 min, 7 pages + 12 endpoints 200 (<100 ms). Known: `docker kill` = manual stop (no auto-restart), documented. |
| 9 | README / docs | ✅ done | README.md (whole project explained, FR), RUN.md (run/stop/troubleshoot), MONGO.md (access + 11 verified queries + teacher demo), APP.md (7 pages explained). |
| 10 | final report | ✅ delivered 2026-10-16 |

## Decisions
- Detector cooldown in EVENT time (window_end) — fixed a duplicate alert created when the stream stalled (2026-10-15).
- Pageviews loaded for the demo: 2023-09-08 12h, 13h, 20h→2023-09-09 06h (slow network); full 49 h range = same command with the default range.
- **Pageviews volume**: measured on the real hour 2023-09-08 22:00: 7,188,874 lines, 2,421,652 merged ar/fr/en rows (≥5: 424,282; ≥10: 208,727; ≥20: 99,730; ≥50: 33,937). Full 48 h ≈ 116M docs ≈ 15+ GB > 30 GB free disk budget. User asked for a **medium dataset** → `PAGEVIEWS_MIN_VIEWS=20` (≈ 5M docs for 49 h). Watchlist titles always kept. README must explain the full-scale run and the 30 GB limit.
- Commits: author CHAKRAbdedaym <chkradobl@gmail.com>, **no Co-Authored-By trailer** (history rewritten + force-pushed once). Push after each step.
- Subagents: custom agent types are not loaded in this session → orchestrator runs them as `general-purpose` agents whose prompt starts with the content of `.claude/agents/<name>.md`, with the model from the table (sonnet/opus/haiku).
- `edit_texts._id` = `"{lang}:{rev_new}"` (rev ids are only unique per wiki).
- Extra collection `scores` (latest z per active article, TTL 1 h) so the radar can show "z if known".
- MongoDB without auth (127.0.0.1 only) so `docker compose exec mongo mongosh radar` works as required.
- Replay sums the article + its redirect titles per language (dumps count redirect views under the redirect name).
- Without a contact in the User-Agent Wikimedia answers HTTP 429. Contact = chkradobl@gmail.com (in .env).

## Earthquake article titles (MediaWiki search + langlinks + redirects + pageviews REST daily 2023-09-08..10)
- en: today `2023 Al Haouz earthquake`; at the time `2023 Marrakesh-Safi earthquake` (09-08: 2,156 · 09-09: 85,857 · 09-10: 68,332 daily views).
- fr: `Séisme de 2023 au Maroc` (09-08: 85 · 09-09: 33,096 · 09-10: 18,084).
- ar: today `زلزال الحوز 2023`; at the time `زلزال مراكش-آسفي 2023` (09-09: 11,838 · 09-10: 5,255).
- Full lists in `ingestion/config/watchlist.json` (contract §7 replay).

## Blocked
- Slow internet: GitHub push pending (`git push` when the network is back). Remaining pageviews hours optional.

## Next
- `git push`; optionally load the remaining pageviews hours; let the stream run ≥ 6 h before the demo so the detector uses per-article baselines.

# Phase finale (thèmes + objets + redesign) — started 2026-10-24

Goals (teacher feedback): (a) data organized by THEMES with a page for EACH OBJECT (event, article); (b) redesign the frontend so it looks hand-crafted (editorial newsroom), not AI-made.

## State at start (2026-10-24 22:21 UTC, measured)
- Stack was stopped; `docker compose up -d` → 7 services Up (mongo/backend/frontend healthy). Volume `radar_mongo-data` intact.
- MongoDB `radar`: edits 113,827 (77,999 distinct articles: en 57,831 · fr 12,367 · ar 7,801; 53,060 with human edits) · edit_texts 44,482 · pageviews 904,116 (10 hours) · alerts 32 (28 distinct articles, 2026-10-15 19:18 → 10-16 15:37) · scores 1,072 · ingestion_log 21. DB 208 MB (data 169 MB, indexes 125 MB). Disk free: 27 GB.
- Stream position: replaying the backlog, newest edit = 2026-10-17 19:25 UTC (Last-Event-ID resume) while real time is 10-24. The detector only scores the current window, so windows skipped during catch-up produced no alerts.
- Pageviews pic hours 2023-09-08 12h,13h,20h → 09-09 03h loaded.

## Steps
| # | step | status | proof / notes |
|---|---|---|---|
| F0 | state + backup + before screenshots + design audit | ✅ done | backup `backups/radar-20261024T2221-phase-finale.archive.gz` (43 MB, mongorestore --dryRun OK). 14 screenshots in `qa/before/` (7 pages × desktop 1440 / mobile 390) via new `qa/shoot.sh`. `docs/DESIGN_AUDIT.md`: current UI 3/10 (radar 3, alertes 2.5, rejouer 4.5, explorateur 3.5, recherche 3, projet 3, article 3); corrections folded into DESIGN_SYSTEM + contract v2.1 (significance / lead rule). Stream switched back to live 2026-10-24 22:41 (user: « ok direct »). |
| F1 | CONTRACT v2.0 + design-critic agent + DESIGN_SYSTEM.md | ✅ done | `docs/CONTRACT.md` v2.0 (§4a themes, §5.7 articles, §5.8 wikidata_entities, §5.9 events, §6 enricher + detector events, §7 new endpoints). `.claude/agents/design-critic.md` created; 6 agents updated with the phase goals. `docs/DESIGN_SYSTEM.md` written. |
| F2 | enricher + themes_mapping.yaml | ✅ done (backfill continues) | commit 21651b0. 332 QIDs verified (`themes --verify`). At 8,600 articles: wikidata 66 %, catégories 10 %, mots-clés 0.1 %, inconnu 24 % (autres 24 % < 40 % gate). All alert / radar / 24 h articles enriched. Review found wrong P279 chains (commune → electoral unit → politique; violent crime → disaster) → fix in progress with F3. |
| F3 | detector events + backfill + Al Haouz historique | ✅ done | commits 8c5b394, 6daddcd. Coverage-aware baseline (4 real segments, gap ≥ 15 min). --backfill-alerts: +32 real alerts (67). 3 alerts computed with the empty baseline after the gap flagged `invalid` (kept, excluded). 49 events (all with qid), alhaouz-2023 = Q122351413 historique (peak 1,969 views/h 2023-09-09 03:00). Lead « 2026 World Series » (sport, en cours). Mapping fix: politique 17.8 % → 6.8 % (communes = lieux → autres). |
| F4 | backend endpoints v2 | ✅ done | commit a80fa05. /api/themes, /themes/timeline, /themes/classification, /themes/{id}, /events, /events/{id}, /frontpage; theme fields on live endpoints; background cache (warm 1–25 ms). api_check v2: 3,456 OK on real db (4 pre-existing/race). Re-verify with real events after F3. |
| F5 | frontend rebuild (editorial) | ✅ done | commit 7f382a3. 10 pages, Tailwind/Recharts removed, tokens.css, self-hosted fonts, SVG charts, old URLs redirect. tsc 0 errors, no overflow, no console errors. |
| F6 | design loop | ✅ stopped after round 2 fixes (user: keep it simple) | R3 screenshots → `qa/after/`. | R1 6.3/10 avg (review committed), fixes 050f4ee. R2 7.1/10 avg (archives 8, Al Haouz event 8; states reviewed). | screenshots `qa/screenshots/round1/` (tool now waits for Wikimedia images, full height up to 9000 px). In parallel: French Wikidata descriptions for events. |
| F7 | QA | ✅ light check | 9 pages + 7 API endpoints 200 (frontpage 22 ms, themes 1.4 s, stats 0.9 s), 0 errors in backend logs, tsc 0, no overflow at 390/1440. Full clean rebuild not redone. |
| F8 | README + docs | ✅ done (APP.md rewritten, démo 5 min, 19 h pageviews) | commit 2999129: README §8–11 (nouveautés, calcul du thème, événements, qualité des données), MONGO.md (new collections + 8 verified queries T1–T8), RUN.md (enricher, detector CLIs, backup/restore, back to live). Snapshot 2026-10-25 05:25 UTC: articles 111,178 (wikidata 72.7 %, autres 31 % incl. 13,596 lieux), events 55. Part b (pages + démo) after the design loop. |
| F9 | final report (FR) | ✅ 2026-10-25 | |

## Data operations log (phase finale)
- 2026-10-24 22:41 UTC: stream back to live (unset `last_event_id`, user « ok direct »).
- 2026-10-25 ~00:44: `detector --backfill-alerts` (+32 alerts), `--flag-invalid-alerts --apply` (3 alerts).
- 2026-10-25 ~01:30–05:00: `enricher --backfill-descriptions` (description_fr on 72k entities).
- 2026-10-25 05:17–05:24 (by docs-writer, out of scope, harmless): mongodump `backups/radar-20261025T0517-docs.archive.gz`, `--backfill-alerts` rerun (0 new), enricher stopped 3.5 min, `--reclassify` (3,183 of 110,296 articles changed after the mapping fixes), `--backfill-descriptions` (1 item). Enricher restarted 05:24.
- 2026-10-25 10:11–11:20: pageviews-loader (detached) loaded the 8 missing hours → 19 hours 2023-09-08 12h → 09-09 06h, 1,756,097 rows. Al Haouz: EN peak 1,579 views/h at 09-09 00h; sum of 3 langs peak 2,037 at 06h, total 12,337.
- 2026-10-25 ~05:35: pageviews-loader relaunched for the hours in error (2023-09-08 14–19 h, 09-09 04–05 h).

## Next (after restart: "read PROGRESS.md and continue")
1. Check `design-critic` is listed as an agent type. Run the audit (F0) on `qa/before/`.
2. In parallel: data-ingestion → F2 (enricher, CONTRACT §5.7/§5.8/§6) ; then F3 ; backend-api → F4 once F2 schemas exist (can start on contract shapes) ; frontend-ui → design tokens + shell (F5) right after the audit.
