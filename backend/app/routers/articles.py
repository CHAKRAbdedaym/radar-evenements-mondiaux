import asyncio
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter

from app.db import db
from app.event_items import active_cut, event_summary
from app.themes import label
from app.util import (alert_item, bad, check_lang, edit_item, iso, norm_title, ref_time,
                      wiki_url)

router = APIRouter(tags=["articles"])


@router.get("/articles/{lang}/{title:path}")
async def article(lang: str, title: str):
    check_lang(lang)
    if not lang:
        raise bad("lang is required")
    title = norm_title(title)
    if not title:
        raise bad("title is required")
    key = {"lang": lang, "title": title}
    since = (await ref_time()) - timedelta(hours=24)

    stats_p = [
        {"$match": key},
        {"$group": {
            "_id": None,
            "edits_total": {"$sum": 1},
            "edits_human": {"$sum": {"$cond": [{"$eq": ["$bot", False]}, 1, 0]}},
            "users": {"$addToSet": "$user"},
            "first_edit": {"$min": "$timestamp"},
            "last_edit": {"$max": "$timestamp"},
            "delta_bytes": {"$sum": {"$ifNull": ["$delta_bytes", 0]}},
        }},
    ]
    timeline_p = [
        {"$match": {**key, "timestamp": {"$gte": since}}},
        {"$group": {"_id": {"$dateTrunc": {"date": "$timestamp", "unit": "minute", "binSize": 5}},
                    "edits": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    ev_filter: dict = {"$or": [{"articles": {"$elemMatch": {"lang": lang, "title": title}}},
                               {f"titles.{lang}": title}, {"key": f"{lang}:{title}"}]}
    stats_r, timeline_r, edits_r, texts_r, alerts_r, pv_count, art_doc, cut = await asyncio.gather(
        db.edits.aggregate(stats_p).to_list(1),
        db.edits.aggregate(timeline_p).to_list(None),
        db.edits.find(key).sort("timestamp", -1).limit(100).to_list(100),
        db.edit_texts.find(key).sort("timestamp", -1).limit(30).to_list(30),
        db.alerts.find(key).sort("created_at", -1).limit(50).to_list(50),
        db.pageviews.count_documents(key),
        db.articles.find_one({"_id": f"{lang}:{title}"}),
        active_cut(),
    )
    if art_doc and art_doc.get("qid"):
        ev_filter["$or"].append({"qid": art_doc["qid"]})
    ev_docs = await db.events.find(ev_filter).sort("last_activity", -1).limit(20).to_list(20)
    s = stats_r[0] if stats_r else None
    if not s and not texts_r and not pv_count:
        raise bad(f"no data for article {lang}:{title}", 404)

    return {
        "lang": lang,
        "title": title,
        "url": wiki_url(lang, title),
        "stats": {
            "edits_total": s["edits_total"] if s else 0,
            "edits_human": s["edits_human"] if s else 0,
            "distinct_users": len(s["users"]) if s else 0,
            "first_edit": iso(s["first_edit"]) if s else None,
            "last_edit": iso(s["last_edit"]) if s else None,
            "delta_bytes": s["delta_bytes"] if s else 0,
        },
        "timeline": [{"t": iso(r["_id"]), "edits": r["edits"]} for r in timeline_r],
        "edits": [edit_item(d) for d in edits_r],
        "texts": [{
            "id": d["_id"], "rev_new": d.get("rev_new"), "timestamp": iso(d.get("timestamp")),
            "comment": d.get("comment"), "added_text": d.get("added_text"),
            "removed_text": d.get("removed_text"),
        } for d in texts_r],
        "alerts": [alert_item(d) for d in alerts_r],
        "pageviews_count": pv_count,
        "enrichment": _enrichment(art_doc),
        "events": [event_summary(d, cut) for d in ev_docs],
    }


def _enrichment(d: Optional[dict]) -> Optional[dict]:
    if not d:
        return None
    return {
        "qid": d.get("qid"),
        "description": d.get("description"),
        "thumbnail_url": d.get("thumbnail_url"),
        "categories": d.get("categories") or [],
        "instance_of": d.get("instance_of") or [],
        "occupations": d.get("occupations") or [],
        "death_date": iso(d.get("death_date")),
        "theme": d.get("theme"),
        "theme_label": label(d.get("theme")),
        "theme_source": d.get("theme_source"),
        "theme_confidence": d.get("theme_confidence"),
        "theme_reason": d.get("theme_reason"),
        "enriched_at": iso(d.get("enriched_at")),
        "wikidata_url": f"https://www.wikidata.org/wiki/{d['qid']}" if d.get("qid") else None,
    }
