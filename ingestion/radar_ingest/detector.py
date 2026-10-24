"""detector: z-score of the last WINDOW_MINUTES of non-bot edits vs a per-article baseline, then events.

All aggregation is done by MongoDB ($group / $dateTrunc); Python only handles the small
per-article result sets. See docs/CONTRACT.md section 6.

Coverage-aware baseline: the history H only counts time actually covered by data. A gap is >= 15 min
without ANY edit (bots included); H starts at the beginning of the current continuous segment, so a
stream outage never produces a "24 h baseline" made of empty buckets.

CLI:  python -m radar_ingest.detector                                  # the service loop
      python -m radar_ingest.detector --backfill-alerts --start ISO --end ISO [--step-seconds 300]
"""
import argparse
import math
import time
from bisect import bisect_right
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from pymongo import InsertOne, UpdateOne
from pymongo.errors import PyMongoError

from . import common
from .events import EventManager
from .common import STOP, env_float, env_int, get_logger

log = get_logger("detector")

BUCKET = timedelta(minutes=5)
STATUS_ID = "detector"
GAP = timedelta(minutes=15)       # no edit at all for this long = a hole in the data
WARMUP = timedelta(minutes=15)    # no scoring until this much covered history exists (a 0/0 baseline is junk)


class Coverage:
    """Continuous-coverage segments built from the minutes that contain at least one edit."""

    def __init__(self, minutes: list):
        self.minutes = minutes
        self.seg_start = []
        prev = None
        for m in minutes:
            if prev is None or m - prev >= GAP:
                cur = m
            self.seg_start.append(cur)
            prev = m

    def segment_start(self, t: datetime):
        """Start of the continuous segment that contains instant `t`, or None if `t` is inside a gap."""
        i = bisect_right(self.minutes, t) - 1
        if i < 0 or t - self.minutes[i] >= GAP:
            return None
        return self.seg_start[i]


class Detector:
    def __init__(self):
        self.db = common.get_db()
        self.edits = self.db["edits"]
        self.interval = env_int("DETECTOR_INTERVAL_SECONDS", 60)
        self.window = timedelta(minutes=env_int("WINDOW_MINUTES", 5))
        self.baseline_hours = env_float("BASELINE_HOURS", 24)
        self.min_history_hours = env_float("MIN_HISTORY_HOURS", 6)
        self.z_threshold = env_float("Z_THRESHOLD", 3)
        self.min_users = env_int("MIN_USERS", 3)
        self.cooldown = timedelta(minutes=env_int("ALERT_COOLDOWN_MINUTES", 15))
        self.events = EventManager(self.db)

    # -- DB aggregations
    def window_stats(self, ws, we):
        pipeline = [
            {"$match": {"bot": False, "timestamp": {"$gte": ws, "$lte": we}}},
            {"$group": {"_id": {"lang": "$lang", "title": "$title"}, "edits": {"$sum": 1},
                        "users": {"$addToSet": "$user"}, "delta": {"$sum": "$delta_bytes"}}},
        ]
        out = {}
        for r in self.edits.aggregate(pipeline, allowDiskUse=True):
            out[(r["_id"]["lang"], r["_id"]["title"])] = {
                "edits": r["edits"], "distinct_users": len(r["users"]), "delta_bytes": r["delta"]}
        return out

    def covered_minutes(self, start, end):
        """Sorted minutes in [start, end] that contain at least one edit (bots included), index-only."""
        pipeline = [{"$match": {"timestamp": {"$gte": start, "$lte": end}}},
                    {"$group": {"_id": {"$dateTrunc": {"date": "$timestamp", "unit": "minute"}}}},
                    {"$sort": {"_id": 1}}]
        return [r["_id"] for r in self.edits.aggregate(pipeline, allowDiskUse=True)]

    def article_baselines(self, keys, start, n):
        """Per-article (sum, sum of squares) of 5-min bucket counts over n buckets before `start+n*5min`.

        Buckets are aligned on the window (bucket i = [start + i*5min, start + (i+1)*5min)),
        so exactly n buckets exist, missing ones count as 0.
        """
        end = start + n * BUCKET
        by_lang = defaultdict(list)
        for lang, title in keys:
            by_lang[lang].append(title)
        res = {}
        for lang, titles in by_lang.items():
            pipeline = [
                {"$match": {"lang": lang, "title": {"$in": titles}, "bot": False,
                            "timestamp": {"$gte": start, "$lt": end}}},
                {"$group": {"_id": {"title": "$title", "b": {"$floor": {"$divide": [
                    {"$subtract": ["$timestamp", start]}, BUCKET.total_seconds() * 1000]}}},
                    "c": {"$sum": 1}}},
                {"$group": {"_id": "$_id.title", "s": {"$sum": "$c"},
                            "s2": {"$sum": {"$multiply": ["$c", "$c"]}}}},
            ]
            for r in self.edits.aggregate(pipeline, allowDiskUse=True):
                res[(lang, r["_id"])] = (r["s"], r["s2"])
        return res

    def provisional_baseline(self, start, ws):
        """median + population std of all non-zero per-(article, 5-min bucket) counts in [start, ws)."""
        if start >= ws:
            return 0.0, 0.0
        pipeline = [
            {"$match": {"bot": False, "timestamp": {"$gte": start, "$lt": ws}}},
            {"$group": {"_id": {"lang": "$lang", "title": "$title",
                                "b": {"$dateTrunc": {"date": "$timestamp", "unit": "minute", "binSize": 5}}},
                        "c": {"$sum": 1}}},
            {"$group": {"_id": "$c", "buckets": {"$sum": 1}}},
            {"$sort": {"_id": 1}},
        ]
        hist = [(r["_id"], r["buckets"]) for r in self.edits.aggregate(pipeline, allowDiskUse=True)]
        total = sum(n for _, n in hist)
        if total == 0:
            return 0.0, 0.0
        # median from histogram
        mid_lo, mid_hi = (total - 1) // 2, total // 2
        acc, vals = 0, {}
        for c, n in hist:
            for idx in (mid_lo, mid_hi):
                if idx not in vals and acc <= idx < acc + n:
                    vals[idx] = c
            acc += n
        median = (vals[mid_lo] + vals[mid_hi]) / 2
        mean = sum(c * n for c, n in hist) / total
        var = sum(n * (c - mean) ** 2 for c, n in hist) / total
        return float(median), math.sqrt(var)

    # -- scoring of one window (shared by the live loop and --backfill-alerts)
    def evaluate(self, ws, we, seg_start, created_at, write_scores):
        """Score [ws, we]. `seg_start` = start of the continuous coverage segment containing ws (or None).
        Returns (scores_count, alerts_inserted, history_hours, baseline_type|None)."""
        active = self.window_stats(ws, we)
        horizon = ws - timedelta(hours=self.baseline_hours)
        hist_start = max(horizon, seg_start) if seg_start else ws
        history = max(ws - hist_start, timedelta(0))
        h_hours = history.total_seconds() / 3600
        if not active or history < WARMUP:
            return 0, 0, h_hours, None
        article_mode = h_hours >= self.min_history_hours
        if article_mode:
            n = int(history / BUCKET)
            bstart = ws - n * BUCKET
            sums = self.article_baselines(list(active), bstart, n)
            btype = "article"
        else:
            med, pstd = self.provisional_baseline(hist_start, ws)
            btype = "provisoire"
        recent = {(a["lang"], a["title"]) for a in self.db["alerts"].find(
            {"window_end": {"$gt": we - self.cooldown, "$lte": we}, "invalid": {"$ne": True}},
            {"lang": 1, "title": 1})}
        scores, alerts_docs = [], []
        for (lang, title), st in active.items():
            if btype == "article":
                sm, s2 = sums.get((lang, title), (0, 0))
                mean = sm / n
                std = math.sqrt(max(s2 / n - mean * mean, 0.0))
            else:
                mean, std = med, pstd
            z = (st["edits"] - mean) / max(std, 1.0)
            if write_scores:
                scores.append(UpdateOne({"_id": f"{lang}:{title}"}, {"$set": {
                    "lang": lang, "title": title, "z_score": z, "edits": st["edits"],
                    "distinct_users": st["distinct_users"], "baseline_mean": mean, "baseline_std": std,
                    "baseline_type": btype, "computed_at": created_at}}, upsert=True))
            if z > self.z_threshold and st["distinct_users"] >= self.min_users and (lang, title) not in recent:
                alerts_docs.append(InsertOne({
                    "lang": lang, "title": title, "window_start": ws, "window_end": we,
                    "edits": st["edits"], "distinct_users": st["distinct_users"],
                    "delta_bytes": st["delta_bytes"], "baseline_mean": mean, "baseline_std": std,
                    "baseline_type": btype, "z_score": z, "created_at": created_at}))
                log.info("ALERT %s:%s edits=%d users=%d z=%.1f (%s baseline mean=%.2f std=%.2f) window_end=%s",
                         lang, title, st["edits"], st["distinct_users"], z, btype, mean, std, we.strftime("%m-%dT%H:%M"))
        if scores:
            self.db["scores"].bulk_write(scores, ordered=False)
        if alerts_docs:
            self.db["alerts"].bulk_write(alerts_docs, ordered=False)
        return len(active), len(alerts_docs), h_hours, btype

    # -- one live cycle
    def run_once(self):
        # EVENT TIME: the window ends at the newest edit timestamp (Wikimedia clock), never at the
        # container wall clock (which may be skewed). The cooldown is measured in event time too.
        wall = common.utcnow()
        ref = common.latest_event_time(self.db)
        if ref is None:
            log.info("cycle: no edits yet, nothing to score")
            return
        now = ref.replace(microsecond=0)
        ws, we = now - self.window, now
        horizon = ws - timedelta(hours=self.baseline_hours)
        cov = Coverage(self.covered_minutes(horizon, we))
        seg = cov.segment_start(ws)
        scored, n_alerts, h_hours, btype = self.evaluate(ws, we, seg, wall, True)
        cov_start = max(horizon, seg) if seg else None
        ev_info = self.events.cycle(now)
        common.log_upsert(self.db, STATUS_ID, {
            "source": STATUS_ID, "last_run_at": wall, "ref_time": now, "articles_scored": scored,
            "alerts_created": n_alerts, "history_hours": round(h_hours, 3),
            "baseline_type": btype or "aucune", "coverage_start": cov_start, "updated_at": wall,
            **{f"events_{k}": v for k, v in ev_info.items()}})
        log.info("cycle: ref(event time)=%s wall=%s window=[%s, %s] scored=%d alerts=%d coverage_start=%s history=%.2fh baseline=%s events=%s",
                 now.strftime("%H:%M:%S"), wall.strftime("%H:%M:%S"), ws.strftime("%H:%M:%S"), we.strftime("%H:%M:%S"),
                 scored, n_alerts, cov_start.strftime("%m-%dT%H:%M") if cov_start else "gap", h_hours,
                 btype or "warmup", ev_info)

    def run(self):
        log.info("started: interval=%ds window=%s baseline=%sh min_history=%sh z>%s users>=%d cooldown=%s",
                 self.interval, self.window, self.baseline_hours, self.min_history_hours,
                 self.z_threshold, self.min_users, self.cooldown)
        self.events.ensure_indexes()
        while not STOP.is_set():
            t0 = time.monotonic()
            try:
                self.run_once()
            except PyMongoError as exc:
                log.error("cycle failed (mongo): %s", exc)
            except Exception:
                log.exception("cycle failed")
            STOP.wait(max(1.0, self.interval - (time.monotonic() - t0)))
        log.info("stopped")

    # -- replay of the same rules over past windows
    def backfill(self, start, end, step):
        """Replay detection over every `step` window of stored edits in [start, end] (same z / users /
        cooldown / coverage rules). Idempotent: the cooldown looks at alerts already stored, including
        the ones from a previous run. Alerts get created_at = window_end (event time)."""
        self.events.ensure_indexes()
        cov = Coverage(self.covered_minutes(start - timedelta(hours=self.baseline_hours) - GAP, end))
        we = start
        windows = created = skipped = 0
        t0 = time.monotonic()
        while we <= end and not STOP.is_set():
            ws = we - self.window
            if cov.segment_start(we) is None:
                skipped += 1
            else:
                _, n_alerts, _, _ = self.evaluate(ws, we, cov.segment_start(ws), we, False)
                created += n_alerts
                windows += 1
            we += step
        log.info("backfill done: %d windows replayed, %d in data gaps skipped, %d new alerts (%.0f s)",
                 windows, skipped, created, time.monotonic() - t0)
        return created


# One-off repair (see flag_invalid_alerts): window of the stream outage resume, before the coverage fix.
BAD_FROM = datetime(2026, 10, 24, 22, 41, tzinfo=timezone.utc)   # first window after the 7-day hole (wall-clock note)
BAD_TO = datetime(2026, 10, 25, 0, 44, tzinfo=timezone.utc)      # first cycle of the coverage-aware detector
INVALID_REASON = ("calculée avec une baseline vide juste après un trou de 7 jours dans le flux "
                  "(avant la correction de la couverture)")


def flag_invalid_alerts(det: "Detector", apply: bool) -> list:
    """Mark (never delete) alerts whose baseline was computed before the coverage fix on data that did not
    exist: window_end in [BAD_FROM, BAD_TO] and either < WARMUP minutes of really covered history, or
    baseline_type "article" with less real history than MIN_HISTORY_HOURS. Selected by rule, not by title.
    Dry run unless `apply`; idempotent."""
    horizon_pad = timedelta(hours=det.baseline_hours) + GAP
    cov = Coverage(det.covered_minutes(BAD_FROM - horizon_pad, BAD_TO))
    matched = []
    for a in det.db["alerts"].find({"window_end": {"$gte": BAD_FROM, "$lte": BAD_TO}}).sort("window_end", 1):
        ws = a["window_start"]
        seg = cov.segment_start(ws)
        real = max(ws - max(ws - timedelta(hours=det.baseline_hours), seg), timedelta(0)) if seg else timedelta(0)
        too_short = real < WARMUP
        fake_article = a.get("baseline_type") == "article" and real.total_seconds() / 3600 < det.min_history_hours
        if too_short or fake_article:
            matched.append(a)
            print(f"MATCH {a['window_end'].strftime('%m-%dT%H:%M')} {a['lang']}:{a['title']} stored={a.get('baseline_type')} "
                  f"mean={a.get('baseline_mean', 0):.2f} real_covered_history={real.total_seconds() / 60:.0f} min "
                  f"already_invalid={bool(a.get('invalid'))}", flush=True)
    if apply and matched:
        res = det.db["alerts"].update_many({"_id": {"$in": [a["_id"] for a in matched]}},
                                           {"$set": {"invalid": True, "invalid_reason": INVALID_REASON}})
        log.info("flagged %d alert(s) invalid (%d newly modified)", len(matched), res.modified_count)
    return matched


def _parse_iso(raw: str) -> datetime:
    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def main():
    parser = argparse.ArgumentParser(description="detector: z-score alerts + events")
    parser.add_argument("--backfill-alerts", action="store_true", help="replay detection over past windows and exit")
    parser.add_argument("--flag-invalid-alerts", action="store_true",
                        help="one-off: list the alerts computed on an empty baseline after the 7-day hole; with --apply, flag them invalid")
    parser.add_argument("--apply", action="store_true", help="write the flags (default: dry run)")
    parser.add_argument("--start", help="ISO start (window end of the first replayed window)")
    parser.add_argument("--end", help="ISO end (default: newest edit)")
    parser.add_argument("--step-seconds", type=int, default=300, help="step between replayed windows (default 300)")
    args = parser.parse_args()
    common.install_signal_handlers(log)
    det = Detector()
    if args.flag_invalid_alerts:
        matched = flag_invalid_alerts(det, args.apply)
        print(f"{len(matched)} alert(s) matched; {'written' if args.apply else 'dry run, nothing written (add --apply)'}")
        if args.apply:
            det.events.cycle(common.latest_event_time(det.db))
        return
    if args.backfill_alerts:
        if not args.start:
            parser.error("--backfill-alerts needs --start")
        end = _parse_iso(args.end) if args.end else common.latest_event_time(det.db)
        det.backfill(_parse_iso(args.start), end, timedelta(seconds=args.step_seconds))
        det.events.cycle(end)  # attach the new alerts to events right away
        return
    det.run()


if __name__ == "__main__":
    main()
