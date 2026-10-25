"""Event summary shape (contract section 7) shared by the themes, events and articles routers."""
import math
from datetime import datetime, timedelta
from typing import Optional

from app.db import EVENT_ACTIVE_HOURS
from app.themes import label
from app.util import iso, ref_time

LANG_PREF = ("fr", "en", "ar")  # French UI: best title is fr > en > ar


async def active_cut() -> datetime:
    """Events whose last_activity is >= this instant are "en cours" (event time)."""
    return (await ref_time()) - timedelta(hours=EVENT_ACTIVE_HOURS)


def event_status(d: dict, cut: datetime) -> str:
    if d.get("kind") == "historique" or d.get("status") == "historique":
        return "historique"
    last = d.get("last_activity")
    if last is None:
        return d.get("status") or "terminé"
    return "en cours" if last >= cut else "terminé"


def best_title(d: dict) -> str:
    titles = d.get("titles") or {}
    for lg in LANG_PREF:
        if titles.get(lg):
            return titles[lg]
    for a in d.get("articles") or []:
        if a.get("title"):
            return a["title"]
    return d.get("key") or str(d.get("_id"))


def spark_values(d: dict, n: int = 24) -> list:
    """The stored spark ([{t, edits}]) as exactly n numbers (oldest -> newest)."""
    vals = [int(p.get("edits", 0)) if isinstance(p, dict) else int(p) for p in (d.get("spark") or [])]
    vals = vals[-n:]
    return [0] * (n - len(vals)) + vals


def compute_significance(d: dict) -> float:
    """Contract 5.9: peak_z x log2(1 + distinct_users) x (1 + 0.5 x (languages - 1)); historique: 50."""
    if d.get("kind") == "historique":
        return 50.0
    langs = max(len(d.get("langs") or []), 1)
    return round((d.get("peak_z") or 0) * math.log2(1 + (d.get("distinct_users") or 0))
                 * (1 + 0.5 * (langs - 1)), 2)


def compute_lead_eligible(d: dict) -> bool:
    if d.get("kind") == "historique":
        return True
    users = d.get("distinct_users") or 0
    enough = users >= 6 or len(d.get("langs") or []) >= 2 or (d.get("total_edits") or 0) >= 15
    return enough and ((d.get("theme") or "autres") != "autres" or users >= 10)


# Same formulas in MongoDB, to ORDER events whose documents lack the stored fields (old docs).
SIG_STAGES = [{"$addFields": {
    "_sig": {"$ifNull": ["$significance", {"$cond": [
        {"$eq": ["$kind", "historique"]}, 50,
        {"$multiply": [
            {"$ifNull": ["$peak_z", 0]},
            {"$log": [{"$add": [1, {"$ifNull": ["$distinct_users", 0]}]}, 2]},
            {"$add": [1, {"$multiply": [0.5, {"$subtract": [
                {"$max": [{"$size": {"$ifNull": ["$langs", []]}}, 1]}, 1]}]}]},
        ]}]}]},
    "_elig": {"$ifNull": ["$lead_eligible", {"$or": [
        {"$eq": ["$kind", "historique"]},
        {"$and": [
            {"$or": [
                {"$gte": [{"$ifNull": ["$distinct_users", 0]}, 6]},
                {"$gte": [{"$size": {"$ifNull": ["$langs", []]}}, 2]},
                {"$gte": [{"$ifNull": ["$total_edits", 0]}, 15]},
            ]},
            {"$or": [
                {"$ne": [{"$ifNull": ["$theme", "autres"]}, "autres"]},
                {"$gte": [{"$ifNull": ["$distinct_users", 0]}, 10]},
            ]},
        ]},
    ]}]},
}}]
SIG_SORT = {"_elig": -1, "_sig": -1, "last_activity": -1}


def event_summary(d: dict, cut: datetime) -> dict:
    theme = d.get("theme") or "autres"
    return {
        "id": str(d["_id"]),
        "kind": d.get("kind"),
        "qid": d.get("qid"),
        "theme": theme,
        "theme_label": label(theme),
        "title": best_title(d),
        "titles": d.get("titles") or {},
        "description": d.get("description"),
        "description_lang": d.get("description_lang"),
        "thumbnail_url": d.get("thumbnail_url"),
        "image_credit": d.get("image_credit"),
        "first_seen": iso(d.get("first_seen")),
        "last_activity": iso(d.get("last_activity")),
        "peak_z": d.get("peak_z"),
        "peak_at": iso(d.get("peak_at")),
        "langs": d.get("langs") or [],
        "total_edits": d.get("total_edits", 0),
        "distinct_users": d.get("distinct_users", 0),
        "alerts_count": d.get("alerts_count", 0),
        "status": event_status(d, cut),
        "significance": d["significance"] if d.get("significance") is not None else compute_significance(d),
        "lead_eligible": d["lead_eligible"] if d.get("lead_eligible") is not None else compute_lead_eligible(d),
        "spark": spark_values(d),
    }


def status_filter(status: Optional[str], cut: datetime) -> dict:
    """Mongo filter for a status computed against event time (stored status may lag a cycle)."""
    if status == "en cours":
        return {"kind": {"$ne": "historique"}, "last_activity": {"$gte": cut}}
    if status == "terminé":
        return {"kind": {"$ne": "historique"}, "last_activity": {"$lt": cut}}
    if status == "historique":
        return {"kind": "historique"}
    return {}
