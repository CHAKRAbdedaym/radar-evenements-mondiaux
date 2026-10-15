"""diff-worker: fetch the text of non-bot edits (action=compare) into MongoDB `edit_texts`."""
import threading
import time
from collections import OrderedDict, deque
from datetime import timedelta

import requests
from bs4 import BeautifulSoup
from pymongo.errors import PyMongoError

from . import common
from .common import STOP, env_float, env_int, get_logger

log = get_logger("diff-worker")

STATUS_ID = "diff-worker"
POLL_SECONDS = 2.0
MAX_TEXT_CHARS = 100_000
N_THREADS = 4


# ----------------------------------------------------------------- diff parsing
def _clean(text: str) -> str:
    return " ".join(text.replace("\xa0", " ").split())


def _is_moved(td) -> bool:
    return td.select_one("a.mw-diff-movedpara-left, a.mw-diff-movedpara-right") is not None


def _side_text(td, inline_tag: str) -> str:
    """Text of one changed cell.

    If the line has inline changes (<ins>/<del class=diffchange>) only those fragments are
    returned, otherwise (whole line added/removed) the full line.
    """
    frags = [_clean(e.get_text()) for e in td.select(f"{inline_tag}.diffchange")]
    frags = [f for f in frags if f]
    if frags:
        return " ".join(frags)
    return _clean(td.get_text())


def parse_diff(body: str):
    """Parse the HTML table rows of an action=compare response -> (added_text, removed_text).

    Context lines (td.diff-context) are ignored; "moved paragraph" lines (marked with
    a.mw-diff-movedpara-*) are not real additions/removals and are ignored too.
    """
    soup = BeautifulSoup(body or "", "html.parser")
    added, removed = [], []
    for td in soup.select("td.diff-addedline"):
        if _is_moved(td):
            continue
        t = _side_text(td, "ins")
        if t:
            added.append(t)
    for td in soup.select("td.diff-deletedline"):
        if _is_moved(td):
            continue
        t = _side_text(td, "del")
        if t:
            removed.append(t)
    return "\n".join(added)[:MAX_TEXT_CHARS], "\n".join(removed)[:MAX_TEXT_CHARS]


# --------------------------------------------------------------- bounded queue
class BoundedPriorityQueue:
    """3 FIFO buckets (priority 0 best). When full, drop the oldest item of the worst bucket."""

    def __init__(self, maxsize: int):
        self.maxsize = maxsize
        self.buckets = [deque(), deque(), deque()]
        self.cond = threading.Condition()
        self.dropped = 0

    def __len__(self):
        return sum(len(b) for b in self.buckets)

    def put(self, prio: int, item):
        """Returns the dropped item (or None)."""
        dropped = None
        with self.cond:
            if len(self) >= self.maxsize:
                for p in (2, 1, 0):
                    if self.buckets[p]:
                        if p < prio:          # everything queued is better than the new item
                            self.dropped += 1
                            return item
                        dropped = self.buckets[p].popleft()
                        self.dropped += 1
                        break
            self.buckets[prio].append(item)
            self.cond.notify()
        return dropped

    def get(self, timeout: float = 1.0):
        with self.cond:
            if len(self) == 0:
                self.cond.wait(timeout)
            for b in self.buckets:
                if b:
                    return b.popleft()
        return None


class RateLimiter:
    def __init__(self, per_sec: float):
        self.interval = 1.0 / max(per_sec, 0.1)
        self.lock = threading.Lock()
        self.next_at = 0.0
        self.pause_until = 0.0

    def pause(self, seconds: float):
        with self.lock:
            self.pause_until = max(self.pause_until, time.monotonic() + seconds)

    def wait(self):
        with self.lock:
            now = time.monotonic()
            at = max(self.next_at, self.pause_until, now)
            self.next_at = at + self.interval
        delay = at - now
        if delay > 0:
            STOP.wait(delay)


# ---------------------------------------------------------------------- worker
class DiffWorker:
    def __init__(self):
        self.db = common.get_db()
        self.edits = self.db["edits"]
        self.texts = self.db["edit_texts"]
        self.queue = BoundedPriorityQueue(env_int("DIFF_QUEUE_MAX", 2000))
        self.limiter = RateLimiter(env_float("DIFF_RATE_PER_SEC", 5))
        self.window = timedelta(minutes=env_int("WINDOW_MINUTES", 5))
        self.lookback = timedelta(minutes=env_int("DIFF_LOOKBACK_MINUTES", 30))
        self.seen = OrderedDict()     # edit ids already enqueued (bounded)
        self.queued = set()           # ids currently in queue or in flight
        self.lock = threading.Lock()
        self.fetched = 0
        self.errors = 0
        self.skipped_empty_err = 0

    # -- producer
    def radar_titles(self):
        # event time (newest edit timestamp), not the wall clock: both sides are Wikimedia time
        ref = common.latest_event_time(self.db)
        if ref is None:
            return set()
        since = ref - self.window
        rows = self.edits.aggregate([
            {"$match": {"lang": "en", "bot": False, "timestamp": {"$gte": since}}},
            {"$group": {"_id": "$title", "n": {"$sum": 1}}},
            {"$match": {"n": {"$gte": 2}}},
        ])
        return {r["_id"] for r in rows}

    def poll_loop(self):
        cursor = common.utcnow() - self.lookback
        while not STOP.is_set():
            try:
                q = {"ingested_at": {"$gte": cursor}, "bot": False,
                     "rev_old": {"$ne": None}, "rev_new": {"$ne": None}}
                docs = list(self.edits.find(q).sort("ingested_at", 1).limit(500))
                new = [d for d in docs if d["_id"] not in self.seen]
                if docs:
                    cursor = max(cursor, docs[-1]["ingested_at"])
                if new:
                    keys = [f"{d['lang']}:{d['rev_new']}" for d in new]
                    done = {r["_id"] for r in self.texts.find({"_id": {"$in": keys}}, {"_id": 1})}
                    hot = self.radar_titles() if any(d["lang"] == "en" for d in new) else set()
                    for d, key in zip(new, keys):
                        self.seen[d["_id"]] = None
                        if key in done:
                            continue
                        prio = 0 if d["lang"] in ("ar", "fr") else (1 if d["title"] in hot else 2)
                        item = {"key": key, "doc": d}
                        with self.lock:
                            self.queued.add(key)
                        dropped = self.queue.put(prio, item)
                        if dropped is not None:
                            with self.lock:
                                self.queued.discard(dropped["key"])
                    while len(self.seen) > 50_000:
                        self.seen.popitem(last=False)
                if len(docs) >= 500:
                    continue  # more waiting, do not sleep
            except PyMongoError as exc:
                log.error("poll error: %s", exc)
            STOP.wait(POLL_SECONDS)

    # -- consumer
    def fetch(self, session, d):
        lang = d["lang"]
        params = {"action": "compare", "fromrev": d["rev_old"], "torev": d["rev_new"],
                  "format": "json", "formatversion": 2}
        resp = session.get(f"https://{lang}.wikipedia.org/w/api.php", params=params, timeout=(10, 30))
        return resp

    def consume_loop(self):
        session = common.make_session()
        while not STOP.is_set():
            item = self.queue.get(1.0)
            if item is None:
                continue
            d, key = item["doc"], item["key"]
            try:
                self.process(session, d, key)
            except Exception as exc:  # never crash the thread
                self.errors += 1
                log.warning("unexpected error for %s: %s: %s", key, type(exc).__name__, exc)
            finally:
                with self.lock:
                    self.queued.discard(key)

    def process(self, session, d, key):
        for attempt in range(3):
            self.limiter.wait()
            if STOP.is_set():
                return
            try:
                resp = self.fetch(session, d)
            except requests.RequestException as exc:
                self.errors += 1
                log.warning("%s: request failed: %s", key, exc)
                return
            if resp.status_code == 429:
                wait = common.parse_retry_after(resp, 30.0)
                log.warning("HTTP 429, pausing all workers %.0fs", wait)
                self.limiter.pause(wait)
                continue
            if resp.status_code >= 400:
                self.errors += 1
                log.warning("%s: HTTP %d, skipped", key, resp.status_code)
                return
            break
        else:
            self.errors += 1
            return
        try:
            payload = resp.json()
        except ValueError:
            self.errors += 1
            log.warning("%s: invalid JSON, skipped", key)
            return
        if "error" in payload:
            self.errors += 1
            log.info("%s: API error %s, skipped", key, (payload["error"] or {}).get("code"))
            return
        body = (payload.get("compare") or {}).get("body")
        if body is None:
            self.errors += 1
            log.info("%s: no diff body, skipped", key)
            return
        added, removed = parse_diff(body)
        self.texts.update_one({"_id": key}, {"$set": {
            "rev_new": d["rev_new"], "rev_old": d["rev_old"], "lang": d["lang"], "title": d["title"],
            "added_text": added, "removed_text": removed, "comment": d.get("comment") or "",
            "timestamp": d["timestamp"], "fetched_at": common.utcnow()}}, upsert=True)
        self.fetched += 1

    # -- status
    def status_loop(self):
        last = time.monotonic()
        last_fetched = 0
        while not STOP.wait(10):
            try:
                common.log_upsert(self.db, STATUS_ID, {
                    "source": STATUS_ID, "fetched": self.fetched, "errors": self.errors,
                    "queue_size": len(self.queue), "dropped": self.queue.dropped,
                    "updated_at": common.utcnow()})
            except PyMongoError as exc:
                log.error("status write failed: %s", exc)
            now = time.monotonic()
            if now - last >= 30:
                log.info("stats: fetched=%d (%.1f/s) errors=%d queue=%d dropped=%d",
                         self.fetched, (self.fetched - last_fetched) / (now - last), self.errors,
                         len(self.queue), self.queue.dropped)
                last, last_fetched = now, self.fetched

    def run(self):
        threads = [threading.Thread(target=self.poll_loop, name="poll", daemon=True),
                   threading.Thread(target=self.status_loop, name="status", daemon=True)]
        threads += [threading.Thread(target=self.consume_loop, name=f"fetch-{i}", daemon=True)
                    for i in range(N_THREADS)]
        for t in threads:
            t.start()
        log.info("started (rate=%.1f/s, queue max=%d, lookback=%s)", 1 / self.limiter.interval,
                 self.queue.maxsize, self.lookback)
        while not STOP.wait(1):
            pass
        for t in threads:
            t.join(timeout=5)
        try:
            common.log_upsert(self.db, STATUS_ID, {"source": STATUS_ID, "fetched": self.fetched,
                                                   "errors": self.errors, "queue_size": len(self.queue),
                                                   "updated_at": common.utcnow()})
        except PyMongoError:
            pass
        log.info("stopped")


def main():
    common.install_signal_handlers(log)
    DiffWorker().run()


if __name__ == "__main__":
    main()
