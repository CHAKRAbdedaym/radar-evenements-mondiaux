import asyncio

from fastapi import APIRouter

from app.db import db
from app.replay import END, EVENT, SERIES, START
from app.util import iso, wiki_url

router = APIRouter(prefix="/replay", tags=["replay"])


@router.get("/alhaouz")
async def alhaouz():
    hour_range = {"$gte": START, "$lte": END}
    log_q = db.ingestion_log.find(
        {"source": "pageviews", "status": "done", "hour": hour_range}, {"hour": 1}
    ).sort("hour", 1).to_list(None)

    def series_q(s):
        return db.pageviews.aggregate([
            {"$match": {"lang": s["lang"], "title": {"$in": s["titles_counted"]}, "hour": hour_range}},
            {"$group": {"_id": "$hour", "views": {"$sum": "$views"}}},
        ]).to_list(None)

    logs, *per_series = await asyncio.gather(log_q, *(series_q(s) for s in SERIES))
    loaded = [d["hour"] for d in logs]

    out = []
    for s, rows in zip(SERIES, per_series):
        views = {r["_id"]: r["views"] for r in rows}
        items = [{"hour": iso(h), "views": views.get(h, 0)} for h in loaded]
        peak = max(items, key=lambda i: i["views"]) if items else None
        out.append({
            "lang": s["lang"],
            "title": s["title"],
            "title_at_time": s["title_at_time"],
            "titles_counted": s["titles_counted"],
            "url": wiki_url(s["lang"], s["title"]),
            "items": items,
            "peak": {"hour": peak["hour"], "views": peak["views"]} if peak else None,
            "total": sum(i["views"] for i in items),
        })
    return {
        "event": {"name": EVENT["name"], "time": iso(EVENT["time"])},
        "start": iso(START),
        "end": iso(END),
        "hours_loaded": len(loaded),
        "series": out,
    }
