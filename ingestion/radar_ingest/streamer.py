"""edits-streamer: Wikimedia EventStreams `recentchange` -> MongoDB `edits`.

The SSE protocol is implemented by hand on top of a streaming `requests` call so we fully
control `Last-Event-ID` (checkpointed in ingestion_log, _id "edits-streamer").
"""
import json
import time
from datetime import datetime, timezone
from urllib.parse import quote

import requests
from pymongo import UpdateOne
from pymongo.errors import PyMongoError

from . import common
from .common import STOP, env_int, env_float, env_str, get_logger

log = get_logger("streamer")

CHECKPOINT_ID = "edits-streamer"
KEEP_TYPES = {"edit", "new"}


# ------------------------------------------------------------------ SSE parser
def sse_events(resp):
    """Yield (event_type, event_id, data) tuples from a streaming SSE response.

    Handles comments (": ..."), multi-line `data:`, `id:`, `event:` and `retry:` fields.
    Comment/keep-alive lines yield (None, None, None) so the caller can run its timers.
    `event_id` is the last id seen on the connection (sticky, as in the SSE spec).
    """
    last_id = None
    event = None
    data_lines = []
    for raw in resp.iter_lines(chunk_size=4096):
        if STOP.is_set():
            return
        line = raw.decode("utf-8", errors="replace")
        if line == "":
            if data_lines:
                yield event or "message", last_id, "\n".join(data_lines)
            event = None
            data_lines = []
            continue
        if line.startswith(":"):
            yield None, None, None  # keep-alive
            continue
        field, sep, value = line.partition(":")
        if sep and value.startswith(" "):
            value = value[1:]
        if field == "data":
            data_lines.append(value)
        elif field == "event":
            event = value
        elif field == "id":
            if "\0" not in value:
                last_id = value
        # "retry" and unknown fields are ignored


# --------------------------------------------------------------------- mapping
def build_url(meta_uri, lang, title):
    if isinstance(meta_uri, str) and meta_uri.startswith("http"):
        return meta_uri
    return f"https://{lang}.wikipedia.org/wiki/{quote(title.replace(' ', '_'), safe='/:()')}"


def map_event(ev: dict, wikis: set):
    """Return the `edits` document (without ingested_at) or None when filtered out."""
    wiki = ev.get("wiki")
    if wiki not in wikis or ev.get("type") not in KEEP_TYPES or ev.get("namespace") != 0:
        return None
    meta = ev.get("meta") or {}
    eid = meta.get("id")
    title = ev.get("title")
    ts = ev.get("timestamp")
    if not eid or not title or not isinstance(ts, (int, float)):
        return None
    lang = wiki[:-4]
    rev = ev.get("revision") or {}
    length = ev.get("length") or {}
    l_old, l_new = length.get("old"), length.get("new")
    delta = None
    if l_new is not None:
        delta = l_new - (l_old or 0)
    return {
        "_id": eid,
        "title": title,
        "lang": lang,
        "wiki": wiki,
        "user": ev.get("user"),
        "bot": bool(ev.get("bot")),
        "type": ev["type"],
        "timestamp": datetime.fromtimestamp(ts, timezone.utc),
        "comment": ev.get("comment") or "",
        "rev_old": rev.get("old"),
        "rev_new": rev.get("new"),
        "length_old": l_old,
        "length_new": l_new,
        "delta_bytes": delta if delta is not None else 0,
        "url": build_url(meta.get("uri"), lang, title),
    }


# ------------------------------------------------------------------------ main
class Streamer:
    def __init__(self):
        self.db = common.get_db()
        self.edits = self.db["edits"]
        self.session = common.make_session()
        self.url = env_str("STREAM_URL", "https://stream.wikimedia.org/v2/stream/recentchange")
        self.wikis = {w.strip() for w in env_str("WIKIS", "arwiki,frwiki,enwiki").split(",") if w.strip()}
        self.batch_size = env_int("STREAM_BATCH_SIZE", 100)
        self.flush_seconds = env_float("STREAM_FLUSH_SECONDS", 2.0)
        self.ops = []
        self.pending_id = None        # latest event id seen (written at next flush)
        self.saved_id = None          # last id persisted
        self.last_flush = time.monotonic()
        self.seen = self.kept = self.written = 0
        self.total_written = 0
        self.errors = 0
        self.stat_t = time.monotonic()
        self.stat_seen = self.stat_kept = self.stat_written = 0

    # -- persistence
    def load_checkpoint(self):
        doc = self.db["ingestion_log"].find_one({"_id": CHECKPOINT_ID}) or {}
        self.saved_id = doc.get("last_event_id")
        self.total_written = int(doc.get("events_written") or 0)
        return self.saved_id

    def flush(self):
        n = len(self.ops)
        if n:
            self.edits.bulk_write(self.ops, ordered=False)
            self.written += n
            self.total_written += n
            self.ops = []
        if n or (self.pending_id and self.pending_id != self.saved_id):
            fields = {"source": CHECKPOINT_ID, "events_written": self.total_written,
                      "updated_at": common.utcnow()}
            if self.pending_id:
                fields["last_event_id"] = self.pending_id
            common.log_upsert(self.db, CHECKPOINT_ID, fields)
            if self.pending_id:
                self.saved_id = self.pending_id
        self.last_flush = time.monotonic()

    def maybe_flush(self, force=False):
        if force or len(self.ops) >= self.batch_size or \
                time.monotonic() - self.last_flush >= self.flush_seconds:
            self.flush()

    def maybe_stats(self):
        now = time.monotonic()
        if now - self.stat_t >= 30:
            dt = now - self.stat_t
            log.info("stats: seen=%d kept=%d written=%d (last %ds: %.1f seen/s, %.2f kept/s) total_written=%d errors=%d",
                     self.seen, self.kept, self.written, dt,
                     (self.seen - self.stat_seen) / dt, (self.kept - self.stat_kept) / dt,
                     self.total_written, self.errors)
            self.stat_t, self.stat_seen, self.stat_kept, self.stat_written = now, self.seen, self.kept, self.written

    # -- one connection
    def stream_once(self):
        headers = {"Accept": "text/event-stream"}
        if self.saved_id:
            headers["Last-Event-ID"] = self.saved_id
        log.info("connecting to %s (Last-Event-ID=%s)", self.url, "yes" if self.saved_id else "none")
        with self.session.get(self.url, headers=headers, stream=True, timeout=(10, 90)) as resp:
            if resp.status_code == 429:
                raise RateLimited(common.parse_retry_after(resp))
            if resp.status_code >= 400:
                if resp.status_code == 400 and self.saved_id:
                    log.warning("HTTP 400 with Last-Event-ID, dropping checkpoint")
                    self.saved_id = None
                raise requests.HTTPError(f"HTTP {resp.status_code}")
            log.info("connected (HTTP %d)", resp.status_code)
            got_event = False
            for etype, eid, data in sse_events(resp):
                if etype is not None:
                    if etype == "message":
                        got_event = True
                        self.handle(data, eid)
                    if eid:
                        self.pending_id = eid
                self.maybe_flush()
                self.maybe_stats()
            return got_event

    def handle(self, data: str, eid):
        self.seen += 1
        try:
            ev = json.loads(data)
            doc = map_event(ev, self.wikis)
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            self.errors += 1
            log.warning("skipping malformed event: %s", exc)
            return
        if doc is None:
            return
        self.kept += 1
        _id = doc.pop("_id")
        self.ops.append(UpdateOne({"_id": _id}, {"$set": doc, "$setOnInsert": {"ingested_at": common.utcnow()}}, upsert=True))

    def run(self):
        self.load_checkpoint()
        backoff = 1.0
        while not STOP.is_set():
            wait = None
            try:
                ok = self.stream_once()
                if ok:
                    backoff = 1.0
                if not STOP.is_set():
                    log.warning("stream ended, reconnecting")
            except RateLimited as exc:
                wait = exc.seconds
                log.warning("HTTP 429, sleeping %.0fs (Retry-After)", wait)
            except (requests.RequestException, OSError) as exc:
                self.errors += 1
                log.warning("stream error: %s: %s", type(exc).__name__, exc)
            except PyMongoError as exc:
                self.errors += 1
                log.error("mongo error: %s", exc)
            try:
                self.flush()
            except PyMongoError as exc:
                log.error("flush failed: %s", exc)
            if STOP.is_set():
                break
            if wait is None:
                wait = backoff
                backoff = min(backoff * 2, 60.0)
            STOP.wait(wait)
        try:
            self.flush()
        except PyMongoError as exc:
            log.error("final flush failed: %s", exc)
        log.info("stopped; total_written=%d", self.total_written)


class RateLimited(Exception):
    def __init__(self, seconds):
        super().__init__(f"rate limited for {seconds}s")
        self.seconds = seconds


def main():
    common.install_signal_handlers(log)
    Streamer().run()


if __name__ == "__main__":
    main()
