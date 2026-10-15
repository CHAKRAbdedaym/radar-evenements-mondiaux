# PROGRESS — Radar d'événements mondiaux

> Updated by the orchestrator after every step. If the session restarts: read this file and continue from "Next".

## Status by step

| # | step | status | proof / notes |
|---|---|---|---|
| 0 | Environment + team + contract | ✅ done | Docker Engine 27.4.1 (server = Docker Engine), Compose v2.32.1, hello-world OK, ports 5173/8000/8081/27017 free, HTTPS 200 on stream/dumps/fr.wikipedia. git init (author CHAKRAbdedaym). 6 subagents in `.claude/agents/`. `docs/CONTRACT.md` v1.0 written. |
| 1 | infra (compose, mongo, mongo-express, init script) | ✅ done | mongo healthy (waits for init), 6 collections + all contract indexes verified, mongo-express 401 without auth / 200 with, both bound to 127.0.0.1. Commit 4997ba5. |
| 2 | edits-streamer | ✅ done | 1,587 real edits after ~15 min (ar 52/12 bot, fr 137/40, en 995/351), Last-Event-ID checkpoint + resume verified, 0 errors, 28 MiB. |
| 3 | diff-worker | ✅ done | 1,155 edit_texts (real wikitext added/removed, ar/fr/en), 0 errors, ≤5 req/s. |
| 4 | pageviews-loader | ⚠️ partial (network) | 1 hour test 2023-09-08T22: 60.6 MB, 7,188,874 lines read, 99,730 rows (min 20), ~52-75 s, re-run skipped. Full 49 h range running in background (log in scratchpad pageviews-full.log). Earthquake titles absent from the 22:00 dump (article created after the quake). |
| 5 | detector | ✅ done | event-time window, ~380 articles scored/cycle, 0 alerts yet: history 0.14 h → provisoire baseline (median 1) → needs ≥5 edits by ≥3 users in 5 min. Alert path proven on a throwaway db. Article baseline needs ≥6 h of stream. |
| 6 | backend | ✅ done | all §7 endpoints curl-verified on real data, stats ~6 ms, radar ~14 ms, IXSCAN only, event-time ref (skew 3605 s measured). Replay/pageviews re-check after full load. |
| 7 | frontend + 2 polish rounds | 🟡 polish round 1 | all 7 pages built (tsc 0 errors), committed. Screenshots by orchestrator (headless Chrome desktop + qa/cdp_screenshot.mjs for true 390px; Playwright image pull impossible on slow network). Round 1 fixes sent: radar blank on mobile, ring/blip label collisions, alert relative time from window_end, replay labels + bdi for Arabic, body bg. | |
| 8 | full QA from scratch | ⏳ todo | |
| 9 | README / docs | 🟡 docs-writer running | |
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
- **Internet connection very slow / down** (2026-10-15 ~19:00 UTC: 7–15 KB/s, then DNS failure). Pageviews: 3/49 hours done (12h, 13h, 22h on 2023-09-08), loader stopped on purpose (user: don't loop); 9 interrupted hours marked error, retried on next run. Playwright image not pulled. Last commits not pushed yet (`git push` when network is back).
- To resume pageviews: `docker compose --profile batch run --rm pageviews-loader --start 2023-09-08T12 --end 2023-09-10T12` (earthquake spike hours: 2023-09-08T23 → 2023-09-09T12 matter most).

## Next
- Review frontend polish round 1, then round 2; README review; when network is back: push, pageviews, step 8 full QA (down/up from scratch), final report.
