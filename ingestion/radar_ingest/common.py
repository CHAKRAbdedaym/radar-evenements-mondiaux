"""Shared helpers: env config, logging, Mongo client, HTTP session, SIGTERM handling."""
import logging
import os
import signal
import sys
import threading
from datetime import datetime, timezone

import requests
from pymongo import MongoClient

# Set by SIGTERM / SIGINT; every service loop must check it (or wait on it).
STOP = threading.Event()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- env helpers
def env_str(name: str, default: str | None = None) -> str:
    val = os.environ.get(name, default)
    if val is None:
        fail(f"missing required environment variable {name}")
    return val


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        fail(f"environment variable {name}={raw!r} is not an integer")


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        fail(f"environment variable {name}={raw!r} is not a number")


def fail(msg: str) -> None:
    print(f"FATAL: {msg}", file=sys.stderr, flush=True)
    sys.exit(2)


# -------------------------------------------------------------------- logging
class _UtcFormatter(logging.Formatter):
    converter = staticmethod(lambda ts: datetime.fromtimestamp(ts, timezone.utc).timetuple())

    def formatTime(self, record, datefmt=None):
        return datetime.fromtimestamp(record.created, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_logger(name: str) -> logging.Logger:
    log = logging.getLogger(name)
    if not log.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(_UtcFormatter("%(asctime)s %(levelname)-7s [%(name)s] %(message)s"))
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        log.propagate = False
    return log


# ---------------------------------------------------------------------- mongo
def get_db():
    uri = env_str("MONGO_URI", "mongodb://mongo:27017")
    name = env_str("MONGO_DB", "radar")
    client = MongoClient(uri, serverSelectionTimeoutMS=15000, appname="radar-ingest", tz_aware=True)
    return client[name]


def latest_event_time(db) -> datetime | None:
    """Event-time reference: the newest edit `timestamp` (Wikimedia's clock), or None if no edits.

    The analytics (detector windows, radar priorities) are driven by event time, not by the
    container wall clock, so a skewed host clock cannot shift the windows. This mirrors the
    event-time / watermark semantics Spark Structured Streaming will use in the next phase.
    """
    doc = db["edits"].find_one({}, {"timestamp": 1}, sort=[("timestamp", -1)])
    if not doc or not doc.get("timestamp"):
        return None
    ts = doc["timestamp"]
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def log_upsert(db, doc_id: str, fields: dict, on_insert: dict | None = None) -> None:
    """Upsert an ingestion_log document (progress / checkpoint)."""
    update = {"$set": fields}
    if on_insert:
        update["$setOnInsert"] = on_insert
    db["ingestion_log"].update_one({"_id": doc_id}, update, upsert=True)


# ----------------------------------------------------------------------- http
def get_user_agent() -> str:
    ua = env_str("WIKI_USER_AGENT", "").strip().strip('"').strip("'")
    if not ua or "EMAIL_HERE" in ua:
        fail("WIKI_USER_AGENT is missing or still contains EMAIL_HERE; "
             "set a real contact e-mail in .env (Wikimedia rejects anonymous clients).")
    return ua


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = get_user_agent()
    return s


def parse_retry_after(resp, default: float = 30.0) -> float:
    raw = resp.headers.get("Retry-After")
    if raw:
        try:
            return max(1.0, min(float(raw), 600.0))
        except ValueError:
            pass
    return default


# --------------------------------------------------------------------- signals
def install_signal_handlers(log: logging.Logger) -> None:
    def _handler(signum, _frame):
        log.info("received signal %s, shutting down", signal.Signals(signum).name)
        STOP.set()

    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)
