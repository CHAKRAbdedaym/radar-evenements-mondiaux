# PROGRESS — Radar d'événements mondiaux

> Updated by the orchestrator after every step. If the session restarts: read this file and continue from "Next".

## Status by step

| # | step | status | proof / notes |
|---|---|---|---|
| 0 | Environment + team + contract | ✅ done | Docker Engine 27.4.1 (server = Docker Engine), Compose v2.32.1, hello-world OK, ports 5173/8000/8081/27017 free, HTTPS 200 on stream/dumps/fr.wikipedia. git init (author CHAKRAbdedaym). 6 subagents in `.claude/agents/`. `docs/CONTRACT.md` v1.0 written. |
| 1 | infra (compose, mongo, mongo-express, init script) | ⏳ todo | |
| 2 | edits-streamer | ⏳ todo | |
| 3 | diff-worker | ⏳ todo | |
| 4 | pageviews-loader | ⏳ todo | |
| 5 | detector | ⏳ todo | |
| 6 | backend | ⏳ todo | |
| 7 | frontend + 2 polish rounds | ⏳ todo | |
| 8 | full QA from scratch | ⏳ todo | |
| 9 | README / docs | ⏳ todo | |
| 10 | final report | ⏳ todo | |

## Decisions
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
- nothing

## Next
- Step 1 (infra-docker) + data-ingestion code in parallel.
