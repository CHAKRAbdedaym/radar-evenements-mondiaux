import asyncio
from fastapi import APIRouter

from app import theme_stats
from app.db import db
from app.event_items import SIG_SORT, SIG_STAGES, active_cut, event_summary, status_filter
from app.themes import THEMES, THEME_LABELS, check_theme
from app.util import bad, iso

router = APIRouter(prefix="/themes", tags=["themes"])

TOP_KEYS = ("lang", "title", "edits_24h", "distinct_users", "qid", "description", "description_fr", "thumbnail_url",
            "image_credit", "theme_source")


async def _events_by_theme(cut) -> dict:
    """Per theme: number of events, number of active events, 3 latest events (small collection)."""
    pipeline = [
        *SIG_STAGES,
        {"$sort": SIG_SORT},
        {"$group": {
            "_id": "$theme",
            "events": {"$sum": 1},
            "active": {"$sum": {"$cond": [{"$and": [
                {"$ne": ["$kind", "historique"]}, {"$gte": ["$last_activity", cut]}]}, 1, 0]}},
            "top": {"$push": "$$ROOT"},
        }},
        {"$project": {"events": 1, "active": 1, "top": {"$slice": ["$top", 3]}}},
    ]
    rows = await db.events.aggregate(pipeline, allowDiskUse=True).to_list(None)
    return {r["_id"] or "autres": r for r in rows}


@router.get("")
async def themes():
    snap, art_counts = await asyncio.gather(theme_stats.snapshot(24), theme_stats.articles_by_theme())
    cut = await active_cut()
    ev = await _events_by_theme(cut)
    items = []
    for tid, tlabel in THEMES:
        trend = snap["hourly"][tid]
        e = ev.get(tid)
        items.append({
            "id": tid, "label": tlabel,
            "events": e["events"] if e else 0,
            "active_events": e["active"] if e else 0,
            "edits_24h": sum(trend),
            "articles": art_counts.get(tid, 0),
            "trend": trend,
            "top_events": [event_summary(d, cut) for d in (e["top"] if e else [])],
        })
    return {"ref_time": iso(snap["ref_time"]), "items": items}


@router.get("/timeline")
async def timeline(hours: int = 24):
    if hours < 1 or hours > 168:
        raise bad("hours must be between 1 and 168")
    snap = await theme_stats.snapshot(hours)
    items = []
    for i, t in enumerate(snap["buckets"]):
        row = {"t": iso(t)}
        for tid, _ in THEMES:
            row[tid] = snap["hourly"][tid][i]
        row["non_classe"] = snap["hourly"][theme_stats.NON_CLASSE][i]
        items.append(row)
    return {"hours": hours, "bucket_seconds": 3600,
            "themes": [{"id": tid, "label": tl} for tid, tl in THEMES], "items": items}


@router.get("/classification")
async def classification():
    c = await theme_stats.classification()
    total = c["total"]

    def pct(n: int) -> float:
        return round(100.0 * n / total, 1) if total else 0.0

    by_theme = [{"id": tid, "label": tl, "count": c["by_theme"].get(tid, 0),
                 "pct": pct(c["by_theme"].get(tid, 0))} for tid, tl in THEMES]
    by_source = [{"source": s, "count": n, "pct": pct(n)}
                 for s, n in sorted(c["by_source"].items(), key=lambda kv: -kv[1])]
    by_lang = [{"lang": lg, "count": n} for lg, n in sorted(c["by_lang"].items(), key=lambda kv: -kv[1])]
    return {
        "total_articles": total, "candidates": c["candidates"],
        "by_theme": by_theme, "by_source": by_source, "by_lang": by_lang,
        "with_qid": c["with_qid"], "with_thumbnail": c["with_thumbnail"],
        "last_enriched_at": iso(c["last"]),
    }


@router.get("/{theme}")
async def theme_detail(theme: str):
    check_theme(theme)
    snap, art_counts = await asyncio.gather(theme_stats.snapshot(24), theme_stats.articles_by_theme())
    cut = await active_cut()
    docs = await db.events.aggregate(
        [{"$match": {"theme": theme}}, *SIG_STAGES, {"$sort": SIG_SORT}, {"$limit": 50}]).to_list(50)
    total, active = await asyncio.gather(
        db.events.count_documents({"theme": theme}),
        db.events.count_documents({"theme": theme, **status_filter("en cours", cut)}),
    )
    trend = snap["hourly"][theme]
    return {
        "id": theme, "label": THEME_LABELS[theme], "ref_time": iso(snap["ref_time"]),
        "events": [event_summary(d, cut) for d in docs],
        "top_articles": [{k: a.get(k) for k in TOP_KEYS} for a in snap["top"].get(theme, [])],
        "timeline": [{"t": iso(t), "edits": n} for t, n in zip(snap["buckets"], trend)],
        "counts": {"events": total, "active_events": active, "edits_24h": sum(trend),
                   "articles": art_counts.get(theme, 0)},
    }
