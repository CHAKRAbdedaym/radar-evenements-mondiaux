"""Shared helpers: dates, params validation, JSON serialisation, tiny TTL cache."""
import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import quote

from bson import ObjectId
from fastapi import HTTPException

LANGS = ("ar", "fr", "en")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def bad(msg: str, code: int = 400) -> HTTPException:
    return HTTPException(status_code=code, detail=msg)


def check_lang(lang: Optional[str]) -> Optional[str]:
    if lang is None or lang == "":
        return None
    if lang not in LANGS:
        raise bad("lang must be one of: ar, fr, en")
    return lang


def norm_title(title: str) -> str:
    """Canonical display form: underscores -> spaces, trimmed, spaces collapsed."""
    return " ".join(title.replace("_", " ").split())


def wiki_url(lang: str, title: str) -> str:
    return f"https://{lang}.wikipedia.org/wiki/" + quote(title.replace(" ", "_"), safe="")


def clamp_limit(limit: int, maximum: int) -> int:
    if limit < 1:
        raise bad("limit must be >= 1")
    return min(limit, maximum)


def check_minutes(minutes: int, lo: int = 1, hi: int = 1440) -> int:
    if minutes < lo or minutes > hi:
        raise bad(f"minutes must be between {lo} and {hi}")
    return minutes


def parse_dt(value: Optional[str], name: str) -> Optional[datetime]:
    """Accepts YYYY-MM-DDTHH or a full ISO-8601 string (Z / offset / naive = UTC)."""
    if value is None or value == "":
        return None
    v = value.strip().replace(" ", "+")  # a raw '+00:00' in a query string becomes a space
    try:
        if len(v) == 13:
            return datetime.strptime(v, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        raise bad(f"{name} must be YYYY-MM-DDTHH or an ISO-8601 datetime")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def floor_bucket(dt: datetime, seconds: int) -> datetime:
    ts = int(dt.timestamp())
    return datetime.fromtimestamp(ts - ts % seconds, tz=timezone.utc)


def to_json(value: Any) -> Any:
    """Recursively make a Mongo document JSON-safe (dates -> ISO Z, ObjectId -> str)."""
    if isinstance(value, datetime):
        return iso(value)
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {str(k): to_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_json(v) for v in value]
    if isinstance(value, bytes):
        return value.hex()
    return value


def edit_item(d: dict) -> dict:
    return {
        "id": d.get("_id"),
        "title": d.get("title"),
        "lang": d.get("lang"),
        "user": d.get("user"),
        "bot": d.get("bot", False),
        "type": d.get("type"),
        "timestamp": iso(d.get("timestamp")),
        "comment": d.get("comment"),
        "delta_bytes": d.get("delta_bytes", 0),
        "url": d.get("url"),
    }


def alert_item(d: dict) -> dict:
    return {
        "id": str(d["_id"]),
        "lang": d.get("lang"),
        "title": d.get("title"),
        "window_start": iso(d.get("window_start")),
        "window_end": iso(d.get("window_end")),
        "edits": d.get("edits"),
        "distinct_users": d.get("distinct_users"),
        "delta_bytes": d.get("delta_bytes"),
        "baseline_mean": d.get("baseline_mean"),
        "baseline_std": d.get("baseline_std"),
        "baseline_type": d.get("baseline_type"),
        "z_score": d.get("z_score"),
        "created_at": iso(d.get("created_at")),
    }


class TTLCache:
    """Tiny async cache for expensive-but-slowly-changing values (one per key)."""

    def __init__(self) -> None:
        self._data: dict = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str, ttl: float, factory: Callable[[], Awaitable[Any]]) -> Any:
        hit = self._data.get(key)
        now = time.monotonic()
        if hit and now - hit[0] < ttl:
            return hit[1]
        async with self._lock:
            hit = self._data.get(key)
            if hit and time.monotonic() - hit[0] < ttl:
                return hit[1]
            value = await factory()
            self._data[key] = (time.monotonic(), value)
            return value


cache = TTLCache()


async def ref_time() -> datetime:
    """Event-time 'now': newest edit timestamp (indexed), cached 2 s; wall clock if no edit yet.

    Windows on event time ('last N minutes') are computed against this value so the API is
    correct whatever the host clock says (same idea as Spark event time).
    """
    from app.db import db

    async def load() -> datetime:
        doc = await db.edits.find_one({}, {"timestamp": 1}, sort=[("timestamp", -1)])
        return doc["timestamp"] if doc and doc.get("timestamp") else utcnow()

    return await cache.get("ref_time", 2, load)
