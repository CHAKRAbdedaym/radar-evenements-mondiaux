import re
from typing import Optional

from fastapi import APIRouter

from app.db import db
from app.util import bad, check_lang, clamp_limit, iso, norm_title, parse_dt

router = APIRouter(prefix="/pageviews", tags=["pageviews"])

EXCLUDED_TITLES = [
    "Main Page", "Wikipédia:Accueil principal", "الصفحة الرئيسية", "-",
]
EXCLUDED_PREFIX = re.compile(r"^(Special:|Spécial:|خاص:)")


async def latest_hour():
    doc = await db.ingestion_log.find_one(
        {"source": "pageviews", "status": "done"}, {"hour": 1}, sort=[("hour", -1)]
    )
    return doc["hour"] if doc else None


@router.get("/top")
async def top(hour: Optional[str] = None, lang: Optional[str] = None, limit: int = 20):
    lang = check_lang(lang)
    limit = clamp_limit(limit, 100)
    h = parse_dt(hour, "hour") or await latest_hour()
    if h is None:
        return {"hour": None, "items": []}
    flt: dict = {"hour": h, "title": {"$nin": EXCLUDED_TITLES, "$not": EXCLUDED_PREFIX}}
    if lang:
        flt["lang"] = lang
    docs = await db.pageviews.find(flt, {"lang": 1, "title": 1, "views": 1}).sort(
        [("hour", -1), ("views", -1)]).limit(limit).to_list(limit)
    return {
        "hour": iso(h),
        "items": [{"lang": d["lang"], "title": d["title"], "views": d["views"]} for d in docs],
    }


@router.get("/{lang}/{title:path}")
async def series(lang: str, title: str, start: Optional[str] = None, end: Optional[str] = None):
    if check_lang(lang) is None:
        raise bad("lang is required")
    title = norm_title(title)
    s, e = parse_dt(start, "start"), parse_dt(end, "end")
    flt: dict = {"lang": lang, "title": title}
    if s or e:
        flt["hour"] = {**({"$gte": s} if s else {}), **({"$lte": e} if e else {})}
    docs = await db.pageviews.find(flt, {"hour": 1, "views": 1}).sort("hour", 1).to_list(None)
    items = [{"hour": iso(d["hour"]), "views": d["views"]} for d in docs]
    return {
        "lang": lang, "title": title,
        "start": iso(s) or (items[0]["hour"] if items else None),
        "end": iso(e) or (items[-1]["hour"] if items else None),
        "items": items,
    }
