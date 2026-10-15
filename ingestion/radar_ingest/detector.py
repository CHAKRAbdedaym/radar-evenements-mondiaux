"""detector: z-score of the last WINDOW_MINUTES of non-bot edits vs a per-article baseline.

All aggregation is done by MongoDB ($group / $dateTrunc); Python only handles the small
per-article result sets. See docs/CONTRACT.md section 6.
"""
import math
import time
from collections import defaultdict
from datetime import timedelta

from pymongo import InsertOne, UpdateOne
from pymongo.errors import PyMongoError

from . import common
from .common import STOP, env_float, env_int, get_logger

log = get_logger("detector")

BUCKET = timedelta(minutes=5)
STATUS_ID = "detector"


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

    def first_edit(self):
        doc = self.edits.find_one({"bot": False}, {"timestamp": 1}, sort=[("timestamp", 1)])
        return doc["timestamp"] if doc else None

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

    # -- one cycle
    def run_once(self):
        # EVENT TIME: the window ends at the newest edit timestamp (Wikimedia clock), never at the
        # container wall clock (which may be skewed). Mirrors Spark event-time / watermark semantics.
        # If the stream stalls, ref stays put: the cycle still runs and the alert cooldown prevents
        # duplicates. Cooldown / created_at / computed_at are processing time (wall clock).
        wall = common.utcnow()
        ref = common.latest_event_time(self.db)
        if ref is None:
            log.info("cycle: no edits yet, nothing to score")
            return
        now = ref.replace(microsecond=0)
        ws, we = now - self.window, now
        active = self.window_stats(ws, we)
        first = self.first_edit()
        horizon = ws - timedelta(hours=self.baseline_hours)
        hist_start = max(horizon, first) if first else ws
        history = max(ws - hist_start, timedelta(0))
        h_hours = history.total_seconds() / 3600
        article_mode = h_hours >= self.min_history_hours

        scores, alerts_docs = [], []
        if active:
            if article_mode:
                n = int(history / BUCKET)
                bstart = ws - n * BUCKET
                sums = self.article_baselines(list(active), bstart, n)
                btype = "article"
            else:
                med, pstd = self.provisional_baseline(hist_start, ws)
                btype = "provisoire"

            recent = {(a["lang"], a["title"]) for a in self.db["alerts"].find(
                {"$or": [{"created_at": {"$gte": wall - self.cooldown}}, {"window_end": we}]},
                {"lang": 1, "title": 1})}

            for (lang, title), s in active.items():
                if btype == "article":
                    sm, s2 = sums.get((lang, title), (0, 0))
                    mean = sm / n
                    std = math.sqrt(max(s2 / n - mean * mean, 0.0))
                else:
                    mean, std = med, pstd
                z = (s["edits"] - mean) / max(std, 1.0)
                base = {"lang": lang, "title": title, "z_score": z, "edits": s["edits"],
                        "distinct_users": s["distinct_users"], "baseline_mean": mean,
                        "baseline_std": std, "baseline_type": btype}
                scores.append(UpdateOne({"_id": f"{lang}:{title}"},
                                        {"$set": {**base, "computed_at": wall}}, upsert=True))
                if z > self.z_threshold and s["distinct_users"] >= self.min_users \
                        and (lang, title) not in recent:
                    alerts_docs.append(InsertOne({
                        "lang": lang, "title": title, "window_start": ws, "window_end": we,
                        "edits": s["edits"], "distinct_users": s["distinct_users"],
                        "delta_bytes": s["delta_bytes"], "baseline_mean": mean, "baseline_std": std,
                        "baseline_type": btype, "z_score": z, "created_at": wall}))
                    log.info("ALERT %s:%s edits=%d users=%d z=%.1f (%s baseline mean=%.2f std=%.2f)",
                             lang, title, s["edits"], s["distinct_users"], z, btype, mean, std)
            if scores:
                self.db["scores"].bulk_write(scores, ordered=False)
            if alerts_docs:
                self.db["alerts"].bulk_write(alerts_docs, ordered=False)

        common.log_upsert(self.db, STATUS_ID, {
            "source": STATUS_ID, "last_run_at": wall, "ref_time": now, "articles_scored": len(scores),
            "alerts_created": len(alerts_docs), "history_hours": round(h_hours, 3),
            "baseline_type": "article" if article_mode else "provisoire",
            "updated_at": wall})
        log.info("cycle: ref(event time)=%s wall=%s window=[%s, %s] active=%d scored=%d alerts=%d history=%.2fh baseline=%s",
                 now.strftime("%H:%M:%S"), wall.strftime("%H:%M:%S"),
                 ws.strftime("%H:%M:%S"), we.strftime("%H:%M:%S"), len(active), len(scores),
                 len(alerts_docs), h_hours, "article" if article_mode else "provisoire")

    def run(self):
        log.info("started: interval=%ds window=%s baseline=%sh min_history=%sh z>%s users>=%d cooldown=%s",
                 self.interval, self.window, self.baseline_hours, self.min_history_hours,
                 self.z_threshold, self.min_users, self.cooldown)
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


def main():
    common.install_signal_handlers(log)
    Detector().run()


if __name__ == "__main__":
    main()
