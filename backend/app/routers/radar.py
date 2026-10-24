import asyncio
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter

from app.annotate import annotate
from app.db import ALERT_COOLDOWN_MINUTES, WINDOW_MINUTES, db
from app.util import check_lang, iso, ref_time

router = APIRouter(tags=["radar"])


@router.get("/radar")
async def radar(lang: Optional[str] = None, include_bots: bool = False):
    lang = check_lang(lang)
    now = await ref_time()
    match: dict = {"timestamp": {"$gte": now - timedelta(minutes=WINDOW_MINUTES)}}
    if lang:
        match["lang"] = lang
    if not include_bots:
        match["bot"] = False
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
        {"$limit": 150},
    ]
    rows = await db.edits.aggregate(pipeline).to_list(150)
    keys = [f"{r['_id']['lang']}:{r['_id']['title']}" for r in rows]
    scores_f = db.scores.find({"_id": {"$in": keys}}, {"z_score": 1, "baseline_type": 1}).to_list(len(keys) or 1)
    alerts_f = db.alerts.find(
        {"window_end": {"$gte": now - timedelta(minutes=ALERT_COOLDOWN_MINUTES)}}, {"lang": 1, "title": 1}
    ).to_list(1000)
    scores, alerts = await asyncio.gather(scores_f, alerts_f)
    score_by = {s["_id"]: s for s in scores}
    alerted = {f"{a['lang']}:{a['title']}" for a in alerts}
    items = []
    for r, k in zip(rows, keys):
        s = score_by.get(k)
        items.append({
            "lang": r["_id"]["lang"], "title": r["_id"]["title"], "edits": r["edits"],
            "distinct_users": r["distinct_users"], "delta_bytes": r["delta_bytes"],
            "last_edit": iso(r["last_edit"]),
            "z_score": s.get("z_score") if s else None,
            "baseline_type": s.get("baseline_type") if s else None,
            "alert": k in alerted,
        })
    return {"window_minutes": WINDOW_MINUTES, "time": iso(now), "items": await annotate(items)}
