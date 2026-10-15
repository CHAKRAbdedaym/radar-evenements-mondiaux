"""pageviews-loader: stream Wikimedia hourly pageview dumps into MongoDB `pageviews`.

Usage: python -m radar_ingest.pageviews --start 2023-09-08T12 --end 2023-09-10T12 [--force] [--min-views N]

The gzip file is streamed over HTTP and parsed line by line: nothing is written to disk and
the dump is never held in memory (only the merged rows of one hour that pass the filter).
"""
import argparse
import gzip
import json
import os
import sys
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import requests
import urllib3
from pymongo import UpdateOne
from pymongo.errors import PyMongoError

from . import common
from .common import STOP, env_int, get_logger

log = get_logger("pageviews")

BASE_URL = "https://dumps.wikimedia.org/other/pageviews/{y}/{y}-{m:02d}/pageviews-{y}{m:02d}{d:02d}-{h:02d}0000.gz"
DOMAINS = {b"ar": "ar", b"fr": "fr", b"en": "en", b"ar.m": "ar", b"fr.m": "fr", b"en.m": "en"}
PROGRESS_SECONDS = 10
MAX_ATTEMPTS = 5


class HourNotFound(Exception):
    pass


def parse_hour(s: str) -> datetime:
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid hour {s!r}, expected YYYY-MM-DDTHH")


def hour_id(h: datetime) -> str:
    return "pageviews:" + h.strftime("%Y-%m-%dT%H")


def hour_url(h: datetime) -> str:
    return BASE_URL.format(y=h.year, m=h.month, d=h.day, h=h.hour)


def load_watchlist():
    path = os.environ.get("WATCHLIST_PATH") or os.path.join(os.path.dirname(__file__), "..", "config", "watchlist.json")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    # compare on the raw dump form: bytes with underscores
    return {lang: {t.replace(" ", "_").encode("utf-8") for t in data.get(lang, [])} for lang in ("ar", "fr", "en")}


class CountingReader:
    """File-like wrapper over the raw HTTP body that counts downloaded (compressed) bytes."""

    def __init__(self, raw):
        self.raw = raw
        self.n = 0

    def read(self, size=-1):
        chunk = self.raw.read(size)
        self.n += len(chunk)
        return chunk


class Stats:
    def __init__(self):
        self.bytes = self.lines_read = self.lines_kept = self.rows_written = self.bad = 0


def process_hour(h: datetime, db, watch, min_views: int, bulk_size: int, force: bool, session_factory):
    """Returns (status, message). Never raises for expected failures."""
    hid = hour_id(h)
    logc = db["ingestion_log"]
    if not force:
        doc = logc.find_one({"_id": hid}, {"status": 1})
        if doc and doc.get("status") == "done":
            log.info("%s already done, skipping (use --force to redo)", hid)
            return "skipped", None
    url = hour_url(h)
    started = common.utcnow()
    t0 = time.monotonic()
    base = {"source": "pageviews", "hour": h, "url": url, "min_views": min_views}
    last_err = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        if STOP.is_set():
            break
        stats = Stats()
        common.log_upsert(db, hid, {**base, "status": "running", "bytes": 0, "lines_read": 0,
                                    "lines_kept": 0, "rows_written": 0, "started_at": started,
                                    "finished_at": None, "duration_s": None, "error": None})
        try:
            run_hour(h, url, db, watch, min_views, bulk_size, stats, session_factory(), t0, hid)
        except HourNotFound:
            msg = "HTTP 404 (hour not available)"
            log.error("%s: %s", hid, msg)
            _finish(db, hid, stats, t0, "error", msg)
            return "error", msg
        # urllib3 errors surface when reading resp.raw directly (e.g. ReadTimeoutError on a slow mirror)
        except (requests.RequestException, urllib3.exceptions.HTTPError, OSError, EOFError, PyMongoError, zlib.error) as exc:
            last_err = f"{type(exc).__name__}: {exc}"
            log.warning("%s: attempt %d/%d failed: %s", hid, attempt, MAX_ATTEMPTS, last_err)
            if attempt < MAX_ATTEMPTS:
                STOP.wait(10 * attempt)
            continue
        else:
            _finish(db, hid, stats, t0, "done", None)
            log.info("%s DONE: %.1f MB, lines read=%d kept=%d bad=%d rows written=%d in %.1fs",
                     hid, stats.bytes / 1e6, stats.lines_read, stats.lines_kept, stats.bad,
                     stats.rows_written, time.monotonic() - t0)
            return "done", None
    msg = last_err or "interrupted"
    _finish(db, hid, stats, t0, "error", msg)
    return "error", msg


def _finish(db, hid, stats, t0, status, error):
    common.log_upsert(db, hid, {"status": status, "bytes": stats.bytes, "lines_read": stats.lines_read,
                                "lines_kept": stats.lines_kept, "rows_written": stats.rows_written,
                                "finished_at": common.utcnow(), "duration_s": round(time.monotonic() - t0, 1),
                                "error": error})


def run_hour(h, url, db, watch, min_views, bulk_size, stats: Stats, session, t0, hid):
    # merged[lang][title_bytes] = desktop + mobile views. Every line of the six target domains
    # is merged (a small part may complete a big one), the min_views filter is applied on the
    # merged total when writing. Keys are raw bytes to keep the per-hour dict compact.
    merged = {"ar": {}, "fr": {}, "en": {}}
    last_progress = time.monotonic()
    with session.get(url, stream=True, timeout=(15, 180), headers={"Accept-Encoding": "identity"}) as resp:
        if resp.status_code == 404:
            raise HourNotFound()
        if resp.status_code == 429:
            wait = common.parse_retry_after(resp, 60.0)
            STOP.wait(wait)
            raise requests.HTTPError("HTTP 429")
        resp.raise_for_status()
        reader = CountingReader(resp.raw)
        with gzip.GzipFile(fileobj=reader) as gz:
            for line in gz:
                stats.lines_read += 1
                if stats.lines_read % 100_000 == 0:
                    now = time.monotonic()
                    if now - last_progress >= PROGRESS_SECONDS:
                        stats.bytes = reader.n
                        _progress(hid, stats, t0)
                        last_progress = now
                    if STOP.is_set():
                        raise OSError("interrupted by signal")
                parts = line.split(b" ")
                if len(parts) < 3:
                    stats.bad += 1
                    continue
                lang = DOMAINS.get(parts[0])
                if lang is None:
                    continue
                try:
                    views = int(parts[2])
                except ValueError:
                    stats.bad += 1
                    continue
                stats.lines_kept += 1
                d = merged[lang]
                title = parts[1]
                d[title] = d.get(title, 0) + views
        stats.bytes = reader.n

    # write phase
    ops = []
    rows = ((lang, title, views) for lang, dd in merged.items() for title, views in dd.items())
    for lang, title, views in rows:
        if views < min_views and title not in watch[lang]:
            continue
        try:
            t = title.decode("utf-8").replace("_", " ")
        except UnicodeDecodeError:
            stats.bad += 1
            continue
        ops.append(UpdateOne({"lang": lang, "title": t, "hour": h}, {"$set": {"views": views}}, upsert=True))
        if len(ops) >= bulk_size:
            db["pageviews"].bulk_write(ops, ordered=False)
            stats.rows_written += len(ops)
            ops = []
            now = time.monotonic()
            if now - last_progress >= PROGRESS_SECONDS:
                _progress(hid, stats, t0)
                last_progress = now
            if STOP.is_set():
                raise OSError("interrupted by signal")
    if ops:
        db["pageviews"].bulk_write(ops, ordered=False)
        stats.rows_written += len(ops)


def _progress(hid, stats: Stats, t0):
    log.info("%s progress: %.1f MB, lines read=%d kept=%d, rows written=%d, elapsed %.0fs",
             hid, stats.bytes / 1e6, stats.lines_read, stats.lines_kept, stats.rows_written,
             time.monotonic() - t0)


def main(argv=None):
    p = argparse.ArgumentParser(description="Load Wikimedia hourly pageview dumps into MongoDB.")
    p.add_argument("--start", type=parse_hour, default=parse_hour("2023-09-08T12"), help="first hour UTC, YYYY-MM-DDTHH")
    p.add_argument("--end", type=parse_hour, default=parse_hour("2023-09-10T12"), help="last hour UTC (inclusive)")
    p.add_argument("--force", action="store_true", help="redo hours already marked done")
    p.add_argument("--min-views", type=int, default=None, help="keep merged rows with views >= N (default env PAGEVIEWS_MIN_VIEWS)")
    args = p.parse_args(argv)
    if args.end < args.start:
        p.error("--end must be >= --start")

    common.install_signal_handlers(log)
    common.get_user_agent()  # fail fast
    min_views = args.min_views if args.min_views is not None else env_int("PAGEVIEWS_MIN_VIEWS", 20)
    bulk_size = env_int("PAGEVIEWS_BULK_SIZE", 5000)
    parallel = max(1, min(env_int("PAGEVIEWS_PARALLEL", 2), 2))
    db = common.get_db()
    db.command("ping")
    watch = load_watchlist()

    hours = []
    h = args.start
    while h <= args.end:
        hours.append(h)
        h += timedelta(hours=1)
    log.info("loading %d hour(s) %s -> %s, min_views=%d (watchlist always kept), bulk=%d, parallel=%d, force=%s",
             len(hours), hours[0].strftime("%Y-%m-%dT%H"), hours[-1].strftime("%Y-%m-%dT%H"),
             min_views, bulk_size, parallel, args.force)

    t0 = time.monotonic()
    def session_factory():
        return common.make_session()

    def work(hour):
        if STOP.is_set():
            return hour, "aborted", None
        try:
            status, msg = process_hour(hour, db, watch, min_views, bulk_size, args.force, session_factory)
        except Exception as exc:  # keep going with other hours
            log.exception("%s: unexpected failure", hour_id(hour))
            status, msg = "error", f"{type(exc).__name__}: {exc}"
            common.log_upsert(db, hour_id(hour), {"status": "error", "error": msg, "finished_at": common.utcnow()})
        return hour, status, msg

    results = {}
    with ThreadPoolExecutor(max_workers=parallel) as pool:
        for hour, status, msg in pool.map(work, hours):
            results.setdefault(status, []).append((hour, msg))

    summary = {k: len(v) for k, v in results.items()}
    log.info("finished in %.1fs: %s", time.monotonic() - t0, summary)
    for hour, msg in results.get("error", []):
        log.error("  %s: %s", hour_id(hour), msg)
    return 1 if results.get("error") or results.get("aborted") else 0


if __name__ == "__main__":
    sys.exit(main())
