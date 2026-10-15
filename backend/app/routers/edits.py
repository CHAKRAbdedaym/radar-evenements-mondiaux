from datetime import timedelta
from typing import Optional

from fastapi import APIRouter

from app.db import db
from app.util import (check_lang, check_minutes, clamp_limit, edit_item, floor_bucket, iso,
                      ref_time)

router = APIRouter(prefix="/edits", tags=["edits"])


def _flt(lang: Optional[str], include_bots: bool) -> dict:
    f: dict = {}
    if lang:
        f["lang"] = lang
    if not include_bots:
        f["bot"] = False
    return f


@router.get("/recent")
async def recent(lang: Optional[str] = None, include_bots: bool = False, limit: int = 50):
    lang = check_lang(lang)
    limit = clamp_limit(limit, 200)
    docs = await db.edits.find(_flt(lang, include_bots)).sort("timestamp", -1).limit(limit).to_list(limit)
    return {"ref_time": iso(await ref_time()), "items": [edit_item(d) for d in docs]}


@router.get("/top")
async def top(minutes: int = 60, lang: Optional[str] = None, include_bots: bool = False, limit: int = 20):
    lang = check_lang(lang)
    check_minutes(minutes)
    limit = clamp_limit(limit, 100)
    match = {"timestamp": {"$gte": (await ref_time()) - timedelta(minutes=minutes)}, **_flt(lang, include_bots)}
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": {"lang": "$lang", "title": "$title"},
            "edits": {"$sum": 1},
            "users": {"$addToSet": "$user"},
            "delta_bytes": {"$sum": {"$ifNull": ["$delta_bytes", 0]}},
            "last_edit": {"$max": "$timestamp"},
        }},
        {"$addFields": {"distinct_users": {"$size": "$users"}}},
        {"$sort": {"edits": -1, "distinct_users": -1, "_id.title": 1}},
        {"$limit": limit},
    ]
    rows = await db.edits.aggregate(pipeline).to_list(limit)
    return {
        "minutes": minutes,
        "items": [{
            "lang": r["_id"]["lang"], "title": r["_id"]["title"], "edits": r["edits"],
            "distinct_users": r["distinct_users"], "delta_bytes": r["delta_bytes"],
            "last_edit": iso(r["last_edit"]),
        } for r in rows],
    }


@router.get("/timeline")
async def timeline(minutes: int = 60, lang: Optional[str] = None, include_bots: bool = False):
    lang = check_lang(lang)
    check_minutes(minutes)
    bucket = 60 if minutes <= 180 else 300
    now = await ref_time()
    first = floor_bucket(now - timedelta(minutes=minutes), bucket)
    last = floor_bucket(now, bucket)
    pipeline = [
        {"$match": {"timestamp": {"$gte": first}, **_flt(lang, include_bots)}},
        {"$group": {
            "_id": {"t": {"$dateTrunc": {"date": "$timestamp", "unit": "minute", "binSize": bucket // 60}},
                    "lang": "$lang"},
            "n": {"$sum": 1},
        }},
    ]
    rows = await db.edits.aggregate(pipeline).to_list(None)
    by_t: dict = {}
    for r in rows:
        by_t.setdefault(int(r["_id"]["t"].timestamp()), {})[r["_id"]["lang"]] = r["n"]
    items = []
    t = first
    step = timedelta(seconds=bucket)
    while t <= last:
        counts = by_t.get(int(t.timestamp()), {})
        item = {"t": iso(t), "ar": counts.get("ar", 0), "fr": counts.get("fr", 0), "en": counts.get("en", 0)}
        item["total"] = item["ar"] + item["fr"] + item["en"]
        items.append(item)
        t += step
    return {"minutes": minutes, "bucket_seconds": bucket, "items": items}
