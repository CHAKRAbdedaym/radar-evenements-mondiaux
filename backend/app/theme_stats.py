"""Heavy theme aggregations (edits of the last hours joined with `articles`), cached in memory.

Order of work, so that MongoDB never joins one row per edit:
  1. $match the non-bot edits of the window (index bot_1_timestamp_-1)
  2. $group by (lang, title, hour) then by (lang, title)  -> one row per article
  3. $lookup the `articles` document (_id = "lang:title", primary-key lookup)
  4. $facet: hourly edits per theme + top articles per theme
Results are kept by the SWR cache (TTL 60 s, refreshed in the background, warmed at startup).
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from app.cache import swr
from app.db import db
from app.themes import THEME_IDS
from app.util import floor_bucket, ref_time

TTL = 60.0
NON_CLASSE = "non_classe"
TOP_N = 20


def hour_list(ref: datetime, hours: int) -> list:
    """`hours` hourly buckets, oldest -> newest, the last one being the hour of `ref`."""
    last = floor_bucket(ref, 3600)
    return [last - timedelta(hours=hours - 1 - i) for i in range(hours)]


async def _build_snapshot(hours: int, detail: bool) -> dict:
    ref = await ref_time()
    buckets = hour_list(ref, hours)
    pipeline = [
        {"$match": {"timestamp": {"$gte": buckets[0]}, "bot": False}},
        {"$group": {
            "_id": {"lang": "$lang", "title": "$title",
                    "t": {"$dateTrunc": {"date": "$timestamp", "unit": "hour"}}},
            "n": {"$sum": 1}, **({"users": {"$addToSet": "$user"}} if detail else {}),
        }},
        {"$group": {
            "_id": {"lang": "$_id.lang", "title": "$_id.title"},
            "hours": {"$push": {"t": "$_id.t", "n": "$n"}},
            **({"users": {"$push": "$users"}} if detail else {}),
            "edits": {"$sum": "$n"},
        }},
        {"$addFields": {
            "_aid": {"$concat": ["$_id.lang", ":", "$_id.title"]},
            **({"distinct_users": {"$size": {"$reduce": {
                "input": "$users", "initialValue": [], "in": {"$setUnion": ["$$value", "$$this"]}}}}}
               if detail else {}),
        }},
        {"$project": {"users": 0}},
    ]
    rows = await db.edits.aggregate(pipeline, allowDiskUse=True).to_list(None)
    # Themes are joined in Python with ONE primary-key query per 5,000 articles: a $lookup with a
    # sub-pipeline cost ~10 s for 24k articles, this takes well under a second.
    docs: dict = {}
    keys = [r["_aid"] for r in rows]
    proj = {"theme": 1, "theme_source": 1, "qid": 1, "description": 1, "description_fr": 1,
            "thumbnail_url": 1, "image_credit": 1}
    for i in range(0, len(keys), 5000):
        async for d in db.articles.find({"_id": {"$in": keys[i:i + 5000]}}, proj):
            docs[d["_id"]] = d
    index = {int(t.timestamp()): i for i, t in enumerate(buckets)}
    hourly: dict = {k: [0] * hours for k in THEME_IDS + [NON_CLASSE]}
    by_theme: dict = {}
    for r in rows:
        a = docs.get(r["_aid"])
        theme = (a or {}).get("theme") or NON_CLASSE
        if theme not in hourly:
            theme = NON_CLASSE
        for h in r["hours"]:
            i = index.get(int(h["t"].timestamp()))
            if i is not None:
                hourly[theme][i] += h["n"]
        if detail and theme != NON_CLASSE:
            by_theme.setdefault(theme, []).append({
                "lang": r["_id"]["lang"], "title": r["_id"]["title"], "edits_24h": r["edits"],
                "distinct_users": r["distinct_users"], "qid": a.get("qid"), "description": a.get("description"),
                "description_fr": a.get("description_fr"), "thumbnail_url": a.get("thumbnail_url"),
                "image_credit": a.get("image_credit"), "theme_source": a.get("theme_source")})
    top = {t: sorted(v, key=lambda x: (-x["edits_24h"], -x["distinct_users"]))[:TOP_N] for t, v in by_theme.items()}
    return {"ref_time": ref, "buckets": buckets, "hourly": hourly, "top": top}


async def snapshot(hours: int = 24) -> dict:
    """hours=24: hourly edits + top articles per theme (with distinct users).
    Any other hours (<= 168): hourly edits only, sliced from ONE cached 168 h computation."""
    if hours == 24:
        return await swr.get("themes:snapshot:24", TTL, lambda: _build_snapshot(24, True))
    full = await swr.get("themes:snapshot:168", TTL, lambda: _build_snapshot(168, False))
    return {"ref_time": full["ref_time"], "buckets": full["buckets"][-hours:], "top": {},
            "hourly": {k: v[-hours:] for k, v in full["hourly"].items()}}


async def _build_articles_by_theme() -> dict:
    rows = await db.articles.aggregate([{"$group": {"_id": "$theme", "n": {"$sum": 1}}}]).to_list(None)
    return {r["_id"]: r["n"] for r in rows if r["_id"]}


async def articles_by_theme() -> dict:
    return await swr.get("themes:articles_by_theme", TTL, _build_articles_by_theme)


# ---- classification (Donnees page) -------------------------------------------------------

async def _pageviews_top_pairs(per_group: int = 200) -> list:
    """Top `per_group` titles per (language, loaded hour) - the enricher's last priority class."""
    logs = await db.ingestion_log.find({"source": "pageviews", "status": "done"}, {"hour": 1}).to_list(None)
    hours = sorted({d["hour"] for d in logs})
    sem = asyncio.Semaphore(4)

    async def one(hour: datetime, lang: str) -> list:
        async with sem:
            docs = await db.pageviews.find({"hour": hour, "lang": lang}, {"lang": 1, "title": 1}) \
                .sort("views", -1).limit(per_group).to_list(per_group)
        return [{"lang": d["lang"], "title": d["title"]} for d in docs]

    parts = await asyncio.gather(*(one(h, lg) for h in hours for lg in ("ar", "fr", "en")))
    seen: dict = {}
    for part in parts:
        for p in part:
            seen[(p["lang"], p["title"])] = p
    return list(seen.values())


async def _build_candidates() -> int:
    """Distinct (lang, title) in edits U alerts U pageviews top."""
    pv = await swr.get("themes:pv_top_pairs", 900.0, _pageviews_top_pairs)
    key = {"_id": {"lang": "$lang", "title": "$title"}}
    pipeline: list = [
        {"$group": key},
        {"$unionWith": {"coll": "alerts", "pipeline": [{"$group": key}]}},
    ]
    if pv:
        pipeline.append({"$unionWith": {"pipeline": [{"$documents": [
            {"_id": {"lang": p["lang"], "title": p["title"]}} for p in pv]}]}})
    pipeline += [{"$group": {"_id": "$_id"}}, {"$count": "n"}]
    res = await db.edits.aggregate(pipeline, allowDiskUse=True).to_list(1)
    return res[0]["n"] if res else 0


async def _build_classification() -> dict:
    facet = [{"$facet": {
        "by_theme": [{"$group": {"_id": "$theme", "n": {"$sum": 1}}}],
        "by_source": [{"$group": {"_id": "$theme_source", "n": {"$sum": 1}}}],
        "by_lang": [{"$group": {"_id": "$lang", "n": {"$sum": 1}}}],
        "misc": [{"$group": {
            "_id": None, "total": {"$sum": 1},
            "with_qid": {"$sum": {"$cond": [{"$ifNull": ["$qid", False]}, 1, 0]}},
            "with_thumbnail": {"$sum": {"$cond": [{"$ifNull": ["$thumbnail_url", False]}, 1, 0]}},
            "last": {"$max": "$enriched_at"},
        }}],
    }}]
    res, candidates = await asyncio.gather(
        db.articles.aggregate(facet, allowDiskUse=True).to_list(1),
        swr.get("themes:candidates", 300.0, _build_candidates),
    )
    res = res[0] if res else {"by_theme": [], "by_source": [], "by_lang": [], "misc": []}
    misc = res["misc"][0] if res["misc"] else {"total": 0, "with_qid": 0, "with_thumbnail": 0, "last": None}
    return {
        "total": misc["total"], "with_qid": misc["with_qid"], "with_thumbnail": misc["with_thumbnail"],
        "last": misc["last"], "candidates": candidates,
        "by_theme": {r["_id"]: r["n"] for r in res["by_theme"] if r["_id"]},
        "by_source": {r["_id"]: r["n"] for r in res["by_source"] if r["_id"]},
        "by_lang": {r["_id"]: r["n"] for r in res["by_lang"] if r["_id"]},
    }


async def classification() -> dict:
    return await swr.get("themes:classification", TTL, _build_classification)


async def warm() -> None:
    """Called once at startup (in the background): fills the caches before the first request."""
    # the lightweight, most requested caches first (timeline, themes); the heavy classification last,
    # so it does not compete with them for MongoDB
    await asyncio.gather(snapshot(168), snapshot(24), articles_by_theme(), return_exceptions=True)
    await asyncio.gather(classification(), return_exceptions=True)
