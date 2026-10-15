# PROGRESS — Radar d'événements mondiaux

> Updated by the orchestrator after every step. If the session restarts: read this file and continue from "Next".

## Status by step

| # | step | status | proof / notes |
|---|---|---|---|
| 0 | Environment + team + contract | 🟡 in progress | Docker Engine 27.4.1 (server = Docker Engine), Compose v2.32.1, hello-world OK, ports 5173/8000/8081/27017 free, HTTPS 200 on stream/dumps/fr.wikipedia. git init (author CHAKRAbdedaym). 6 subagents in `.claude/agents/`. `docs/CONTRACT.md` v1.0 written. |
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
- **Pageviews volume**: measured on the real hour 2023-09-08 22:00: 7,188,874 lines, 2,421,652 merged ar/fr/en rows (≥2 views: 1,094,943; ≥5 views: 424,282). 48 h × 2.4M ≈ 116M docs ≈ 15+ GB, too much for the 30 GB free disk / 7.6 GB RAM. → `PAGEVIEWS_MIN_VIEWS=5` (configurable) ≈ 20M docs; earthquake watchlist titles always kept in full. All lines are still read and counted (ingestion_log.lines_read).
- `edit_texts._id` = `"{lang}:{rev_new}"` (rev ids are only unique per wiki).
- Extra collection `scores` (latest z per active article, TTL 1 h) so the radar can show "z if known".
- MongoDB without auth (127.0.0.1 only) so `docker compose exec mongo mongosh radar` works as required.
- Replay sums the article + its redirect titles per language (dumps count redirect views under the redirect name).
- Without a contact in the User-Agent, Wikimedia answers HTTP 429 to the API → real contact email required.

## Earthquake article titles (MediaWiki search + langlinks)
- en: `2023 Al Haouz earthquake` (current). Langlinks → fr `Séisme de 2023 au Maroc`, ar `زلزال الحوز 2023`; fr → en confirmed.
- Redirects en: 2023 Morocco earthquake, 2023 Marrakesh–Safi earthquake, 2023 Marrakesh-Safi earthquake, 2023 Moroccan earthquake, 2023 Chichaoua earthquake, 2023 Moroco earthquake.
- Redirects ar: زلزال مراكش, زلزال الحوز, زلزال المغرب 2023, زلزال مراكش-آسفي 2023, زلزال مراكش آسفي 2023, زلزال إغيل 2023.
- TODO: check move logs (title used on 2023-09-08..10) once the User-Agent has a contact (blocked by 429).

## Blocked
- Contact email for `WIKI_USER_AGENT` (asked the user).

## Next
- Get email → put in `.env` → verify subagents detected → step 1 (infra-docker).
