import asyncio
from datetime import timedelta
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter

from app.db import db
from app.event_items import SIG_SORT, SIG_STAGES, active_cut, event_summary, status_filter
from app.annotate import annotate
from app.themes import check_theme
from app.util import alert_item, bad, floor_bucket, iso, ref_time, wiki_url
from app.routers.replay import alhaouz

router = APIRouter(prefix="/events", tags=["events"])

STATUSES = ("en cours", "terminé", "historique")
KINDS = ("detected", "historique")
SORTS = {"recent": {"last_activity": -1}, "peak": {"peak_z": -1, "last_activity": -1},
         "significance": SIG_SORT}
MAX_PAIRS = 12


@router.get("")
async def list_events(theme: Optional[str] = None, status: Optional[str] = None,
                      kind: Optional[str] = None, sort: str = "recent", lead: bool = False,
                      limit: int = 20):
    theme = check_theme(theme)
    if status not in (None, "") and status not in STATUSES:
        raise bad("status must be one of: " + ", ".join(STATUSES))
    if kind not in (None, "") and kind not in KINDS:
        raise bad("kind must be one of: " + ", ".join(KINDS))
    if sort not in SORTS:
        raise bad("sort must be one of: " + ", ".join(SORTS))
    if limit < 1:
        raise bad("limit must be >= 1")
    limit = min(limit, 100)
    cut = await active_cut()
    flt: dict = status_filter(status or None, cut)
    if theme:
        flt["theme"] = theme
    if kind:
        flt = {"$and": [flt, {"kind": kind}]} if flt.get("kind") else {**flt, "kind": kind}
    pipeline = [{"$match": flt}, *SIG_STAGES]
    if lead:
        pipeline.append({"$match": {"_elig": True}})
    count_p = [*pipeline, {"$count": "n"}]
    docs, total = await asyncio.gather(
        db.events.aggregate([*pipeline, {"$sort": SORTS[sort]}, {"$limit": limit}]).to_list(limit),
        db.events.aggregate(count_p).to_list(1),
    )
    return {"count": total[0]["n"] if total else 0, "items": [event_summary(d, cut) for d in docs]}


async def _find_event(event_id: str) -> dict:
    doc = await db.events.find_one({"_id": event_id})
    if doc is None:
        raise bad(f"unknown event '{event_id}'", 404)
    return doc


async def _pairs(ev: dict) -> list:
    """(lang, title) of the event: alerted articles + sitelink titles + articles sharing its qid."""
    pairs: dict = {}
    for a in ev.get("articles") or []:
        pairs[(a["lang"], a["title"])] = None
    for lg, t in (ev.get("titles") or {}).items():
        if t:
            pairs[(lg, t)] = None
    if ev.get("qid"):
        async for a in db.articles.find({"qid": ev["qid"]}, {"lang": 1, "title": 1}):
            pairs[(a["lang"], a["title"])] = None
    return list(pairs)[:MAX_PAIRS]


@router.get("/{event_id}")
async def event_detail(event_id: str):
    ev = await _find_event(event_id)
    cut = await active_cut()
    summary = event_summary(ev, cut)
    historic = summary["status"] == "historique"
    pairs = await _pairs(ev)
    or_pairs = [{"lang": lg, "title": t} for lg, t in pairs]

    # articles of the event with their theme explanation
    ids = [f"{lg}:{t}" for lg, t in pairs]
    art_docs = {d["_id"]: d async for d in db.articles.find(
        {"_id": {"$in": ids}}, {"theme": 1, "theme_source": 1, "theme_reason": 1})}
    arts = []
    for a in ev.get("articles") or []:
        d = art_docs.get(f"{a['lang']}:{a['title']}", {})
        arts.append({"lang": a["lang"], "title": a["title"], "url": wiki_url(a["lang"], a["title"]),
                     "theme": d.get("theme"), "theme_source": d.get("theme_source"),
                     "theme_reason": d.get("theme_reason")})
    summary["articles"] = arts
    summary["wikidata_url"] = f"https://www.wikidata.org/wiki/{ev['qid']}" if ev.get("qid") else None
    links = {}
    for lg, t in (ev.get("titles") or {}).items():
        links[lg] = {"lang": lg, "title": t, "url": wiki_url(lg, t)}
    for a in arts:
        links.setdefault(a["lang"], {"lang": a["lang"], "title": a["title"], "url": a["url"]})
    summary["links"] = [links[lg] for lg in ("fr", "en", "ar") if lg in links]
    summary["peak_views"] = ev.get("peak_views")
    summary["total_views"] = ev.get("total_views")

    first, last = ev.get("first_seen"), ev.get("last_activity")
    timeline: list = []
    texts: list = []
    editors: list = []
    bucket = 300
    if or_pairs and first and not historic:
        start = first - timedelta(hours=1)
        end = last or await ref_time()
        bucket = 300 if end - start <= timedelta(hours=12) else 3600
        start_b, end_b = floor_bucket(start, bucket), floor_bucket(end, bucket)
        match = {"$or": or_pairs, "bot": False, "timestamp": {"$gte": start, "$lte": end}}
        unit, size = ("minute", 5) if bucket == 300 else ("hour", 1)
        tl_rows, ed_rows, text_docs = await asyncio.gather(
            db.edits.aggregate([
                {"$match": match},
                {"$group": {"_id": {"t": {"$dateTrunc": {"date": "$timestamp", "unit": unit, "binSize": size}},
                                    "lang": "$lang"}, "n": {"$sum": 1}}},
            ]).to_list(None),
            db.edits.aggregate([
                {"$match": match},
                {"$group": {"_id": "$user", "edits": {"$sum": 1}}},
                {"$sort": {"edits": -1, "_id": 1}}, {"$limit": 10},
            ]).to_list(10),
            db.edit_texts.find({"$or": or_pairs}).sort("timestamp", -1).limit(20).to_list(20),
        )
        by_t: dict = {}
        for r in tl_rows:
            by_t.setdefault(int(r["_id"]["t"].timestamp()), {})[r["_id"]["lang"]] = r["n"]
        t = start_b
        while t <= end_b:
            c = by_t.get(int(t.timestamp()), {})
            row = {"t": iso(t), "ar": c.get("ar", 0), "fr": c.get("fr", 0), "en": c.get("en", 0)}
            row["total"] = row["ar"] + row["fr"] + row["en"]
            timeline.append(row)
            t += timedelta(seconds=bucket)
        editors = [{"user": r["_id"], "edits": r["edits"]} for r in ed_rows]
        texts = [{"id": d["_id"], "lang": d.get("lang"), "title": d.get("title"),
                  "timestamp": iso(d.get("timestamp")), "comment": d.get("comment"),
                  "added_text": d.get("added_text")} for d in text_docs]

    # pageviews: the replay series for the historical event, otherwise stored hours of its titles
    pageviews: list = []
    if historic:
        rep = await alhaouz()
        pageviews = [{"lang": s["lang"], "title": s["title"], "items": s["items"]} for s in rep["series"]]
    elif or_pairs:
        rows = await db.pageviews.find({"$or": or_pairs}, {"lang": 1, "title": 1, "hour": 1, "views": 1}) \
            .sort("hour", 1).to_list(5000)
        grouped: dict = {}
        for r in rows:
            grouped.setdefault((r["lang"], r["title"]), []).append({"hour": iso(r["hour"]), "views": r["views"]})
        pageviews = [{"lang": lg, "title": t, "items": it} for (lg, t), it in grouped.items()]

    alert_filter: dict = {"event_id": str(ev["_id"])}
    oids = []
    for x in ev.get("alert_ids") or []:
        try:
            oids.append(ObjectId(x))
        except (InvalidId, TypeError):
            pass
    if oids:
        alert_filter = {"$or": [alert_filter, {"_id": {"$in": oids}}]}
    alert_docs = await db.alerts.find({"$and": [alert_filter, {"invalid": {"$ne": True}}]}).sort("created_at", -1).limit(50).to_list(50)
    alert_rows = [alert_item(d) for d in alert_docs]
    await annotate(alert_rows)

    return {"event": summary, "bucket_seconds": bucket, "timeline": timeline, "texts": texts,
            "pageviews": pageviews, "alerts": alert_rows, "editors_top": editors}
