import asyncio
from datetime import timedelta

from fastapi import APIRouter

from app.db import db
from app.event_items import SIG_STAGES, active_cut, event_summary
from app.themes import THEMES
from app.util import iso, ref_time

router = APIRouter(tags=["frontpage"])

SECTION_SIZE = 4


async def _lead(since, cut):
    """Most significant lead_eligible event active since `since`; "en cours" ones first."""
    pipeline = [
        {"$match": {"kind": {"$ne": "historique"}, "last_activity": {"$gte": since}}},
        *SIG_STAGES,
        {"$match": {"_elig": True}},
        {"$addFields": {"_live": {"$gte": ["$last_activity", cut]}}},
        {"$sort": {"_live": -1, "_sig": -1, "last_activity": -1}},
        {"$limit": 1},
    ]
    rows = await db.events.aggregate(pipeline).to_list(1)
    return rows[0] if rows else None


@router.get("/frontpage")
async def frontpage():
    now = await ref_time()
    cut = await active_cut()
    sections_p = [
        *SIG_STAGES,
        {"$sort": {"_elig": -1, "_sig": -1, "last_activity": -1}},
        {"$group": {"_id": "$theme", "events": {"$push": "$$ROOT"}}},
        {"$project": {"events": {"$slice": ["$events", SECTION_SIZE]}}},
    ]
    l48, l7, rows = await asyncio.gather(
        _lead(now - timedelta(hours=48), cut),
        _lead(now - timedelta(days=7), cut),
        db.events.aggregate(sections_p, allowDiskUse=True).to_list(None),
    )
    lead, reason = (l48, "48h") if l48 else (l7, "7j") if l7 else (None, None)
    if lead is None:
        lead = await db.events.find_one({"_id": "alhaouz-2023"})
        reason = "archives" if lead else None
    by_theme = {r["_id"] or "autres": r["events"] for r in rows}
    return {
        "ref_time": iso(now),
        "lead": event_summary(lead, cut) if lead else None,
        "lead_reason": reason,
        "sections": [{"id": tid, "label": tl,
                      "events": [event_summary(d, cut) for d in by_theme.get(tid, [])]}
                     for tid, tl in THEMES],
    }
