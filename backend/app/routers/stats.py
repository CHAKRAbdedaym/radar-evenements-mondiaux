import asyncio
from datetime import timedelta

from fastapi import APIRouter

from app.db import ALERT_COOLDOWN_MINUTES, WINDOW_MINUTES, coll_stats, db  # noqa: F401
from app.util import LANGS, cache, iso, ref_time, utcnow

router = APIRouter(tags=["stats"])

COLLECTIONS = ["edits", "edit_texts", "pageviews", "alerts", "ingestion_log"]


async def _sizes():
    """Collection + db sizes from metadata (no scan); cached 10 s."""
    cols, dbs = await asyncio.gather(
        asyncio.gather(*(coll_stats(c) for c in COLLECTIONS)),
        db.command("dbStats"),
    )
    collections = {
        c: {k: s[k] for k in ("count", "size_bytes", "avg_doc_bytes")} for c, s in zip(COLLECTIONS, cols)
    }
    data, storage, index = int(dbs.get("dataSize", 0)), int(dbs.get("storageSize", 0)), int(dbs.get("indexSize", 0))
    return collections, {
        "data_size_bytes": data,
        "storage_size_bytes": storage,
        "index_size_bytes": index,
        "total_size_bytes": int(dbs.get("totalSize", storage + index)),
    }


async def _per_lang():
    """Index-only counts per language; cached 15 s."""
    counts = await asyncio.gather(*(db.edits.count_documents({"lang": l}) for l in LANGS))
    items = [{"lang": l, "count": c} for l, c in zip(LANGS, counts)]
    return sorted(items, key=lambda x: -x["count"])


async def _edge(direction: int):
    doc = await db.edits.find_one({}, {"timestamp": 1}, sort=[("timestamp", direction)])
    return doc["timestamp"] if doc else None


@router.get("/stats")
async def stats():
    server_now = utcnow()
    ref = await ref_time()  # event time: newest edit timestamp
    minute_ago = ref - timedelta(seconds=60)
    hour_ago = ref - timedelta(hours=1)
    window_start = ref - timedelta(minutes=WINDOW_MINUTES)
    ingest_minute_ago = server_now - timedelta(seconds=60)  # processing time vs wall clock

    last_hour_p = [
        {"$match": {"timestamp": {"$gte": hour_ago}}},
        {"$group": {
            "_id": "$bot",
            "n": {"$sum": 1},
            "last_min": {"$sum": {"$cond": [{"$gte": ["$timestamp", minute_ago]}, 1, 0]}},
        }},
    ]
    active_p = [
        {"$match": {"timestamp": {"$gte": window_start}, "bot": False}},
        {"$group": {"_id": {"l": "$lang", "t": "$title"}}},
        {"$count": "n"},
    ]

    (sizes, per_lang, hour_rows, ingest_rate, active, active_alerts, first_edit, last_edit, pv_hours) = await asyncio.gather(
        cache.get("sizes", 10, _sizes),
        cache.get("per_lang", 15, _per_lang),
        db.edits.aggregate(last_hour_p).to_list(5),
        db.edits.count_documents({"ingested_at": {"$gte": ingest_minute_ago}}),
        db.edits.aggregate(active_p).to_list(1),
        db.alerts.count_documents({"window_end": {"$gte": hour_ago}, "invalid": {"$ne": True}}),
        cache.get("first_edit", 60, lambda: _edge(1)),
        _edge(-1),
        db.ingestion_log.count_documents({"source": "pageviews", "status": "done"}),
    )
    collections, db_sizes = sizes

    bot = human = last_min = 0
    for r in hour_rows:
        last_min += r["last_min"]
        if r["_id"]:
            bot += r["n"]
        else:
            human += r["n"]
    total_hour = bot + human

    return {
        "time": iso(ref),
        "ref_time": iso(ref),
        "server_time": iso(server_now),
        "clock_skew_seconds": round((ref - server_now).total_seconds()),
        "collections": collections,
        "db": db_sizes,
        "edits_per_lang": per_lang,
        "edits_last_minute": last_min,
        "edits_last_hour": total_hour,
        "bots": {"bot": bot, "human": human, "bot_pct": round(100 * bot / total_hour, 1) if total_hour else 0.0},
        "ingestion_rate_per_min": ingest_rate,
        "active_articles": active[0]["n"] if active else 0,
        "active_alerts": active_alerts,
        "first_edit_at": iso(first_edit),
        "last_edit_at": iso(last_edit),
        "pageviews_hours_loaded": pv_hours,
    }
