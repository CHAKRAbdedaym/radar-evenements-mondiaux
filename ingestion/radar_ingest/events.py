"""events: group alerts into real-world events (docs/CONTRACT.md 5.9 and section 6 "detector - events").

Called by the detector every cycle (EventManager.cycle):
  1. attach every alert without `event_id` to an event (oldest first, so the first run is the backfill):
     key = Wikidata qid of the article, else "lang:title"; same key within EVENT_MERGE_HOURS -> same event;
  2. re-key events whose article got a qid (merging two events of the same qid, the only delete allowed);
  3. refresh active events (last_activity, langs, edits, users, spark, peak, theme, titles, significance...);
  4. close events that left the active window; 5. keep the historical event `alhaouz-2023`.
"""
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pymongo import ReplaceOne, UpdateOne
from pymongo.errors import DuplicateKeyError, PyMongoError

from . import common, themes
from .common import env_float, env_int, get_logger, utcnow

log = get_logger("events")

QID_RE = re.compile(r"^Q\d+$")
LANG_PREF = ("en", "fr", "ar")                 # best article for description / thumbnail
SITE_TO_LANG = {"arwiki": "ar", "frwiki": "fr", "enwiki": "en"}
HIST_ID = "alhaouz-2023"
HIST_FIRST_SEEN = datetime(2023, 9, 8, 22, 11, tzinfo=timezone.utc)
HIST_EN_TITLE = "2023 Al Haouz earthquake"
# Titles shown for the replay (backend/app/replay.py); the counted titles come from config/watchlist.json
REPLAY_TITLES = {"ar": "زلزال الحوز 2023", "fr": "Séisme de 2023 au Maroc", "en": "2023 Al Haouz earthquake"}
HIST_REFRESH_SECONDS = 600


def significance(peak_z, distinct_users, n_langs) -> float:
    """Contract 5.9 (v2.1): peak_z x log2(1 + distinct_users) x (1 + 0.5 x (languages - 1))."""
    return round((peak_z or 0) * math.log2(1 + (distinct_users or 0)) * (1 + 0.5 * (max(n_langs, 1) - 1)), 2)


def lead_eligible(distinct_users, n_langs, total_edits, theme) -> bool:
    enough = (distinct_users or 0) >= 6 or n_langs >= 2 or (total_edits or 0) >= 15
    return bool(enough and (theme != "autres" or (distinct_users or 0) >= 10))


def _as_utc(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class EventManager:
    def __init__(self, db):
        self.db = db
        self.merge = timedelta(hours=env_int("EVENT_MERGE_HOURS", 48))
        self.active = timedelta(hours=env_int("EVENT_ACTIVE_HOURS", 2))
        self.mapping = themes.load_mapping()
        self._api = None
        self._hist_done = 0.0

    # ------------------------------------------------------------------ setup
    def ensure_indexes(self):
        e, a = self.db["events"], self.db["alerts"]
        e.create_index([("significance", -1)])
        e.create_index([("theme", 1), ("last_activity", -1)])
        e.create_index([("status", 1), ("last_activity", -1)])
        e.create_index([("key", 1), ("last_activity", -1)])
        e.create_index([("qid", 1)])
        e.create_index([("peak_z", -1)])
        a.create_index([("event_id", 1)])
        a.create_index([("window_end", -1)])
        log.info("indexes ensured on events and alerts")

    # ------------------------------------------------------------------ cycle
    def cycle(self, ref) -> dict:
        info = {"attached": 0, "created": 0, "merged": 0, "refreshed": 0}
        try:
            purged, touched0 = self.purge_invalid()
            info["purged"] = purged
            touched, attached, created = self.attach_alerts()
            touched |= touched0
            info["attached"], info["created"] = attached, created
            merged, rekeyed = self.rekey(touched)
            info["merged"] = merged
            info["refreshed"] = self.refresh(ref, touched)
            self.close_old(ref)
            if time_since(self._hist_done) > HIST_REFRESH_SECONDS:
                self.ensure_historical()
        except PyMongoError as exc:
            log.error("events cycle failed (mongo): %s", exc)
        except Exception:  # noqa: BLE001 - never kill the detector for the events
            log.exception("events cycle failed")
        info["total"] = self.db["events"].estimated_document_count()
        return info

    # ------------------------------------------------- 0. alerts flagged invalid
    def purge_invalid(self):
        """Alerts flagged `invalid: true` never count. An event made only of invalid alerts is removed
        (derived doc: the only other delete allowed); otherwise the invalid alerts are detached and the
        event is recomputed without them. Their `event_id` is unset. Returns (events removed, touched ids)."""
        db = self.db
        by_event = defaultdict(list)
        for a in db["alerts"].find({"invalid": True, "event_id": {"$exists": True}}, {"event_id": 1}):
            by_event[a["event_id"]].append(a["_id"])
        removed, touched = 0, set()
        for eid, ids in by_event.items():
            valid = db["alerts"].count_documents({"event_id": eid, "invalid": {"$ne": True}})
            db["alerts"].update_many({"_id": {"$in": ids}}, {"$unset": {"event_id": ""}})
            if valid == 0:
                db["events"].delete_one({"_id": eid})
                removed += 1
                log.info("removed event %s: all its alerts are flagged invalid", eid)
            else:
                touched.add(eid)
                log.info("event %s keeps %d valid alert(s), %d invalid detached", eid, valid, len(ids))
        return removed, touched

    # --------------------------------------------------------------- 1. attach
    def article_qids(self, pairs) -> dict:
        keys = [f"{lang}:{title}" for lang, title in pairs]
        out = {}
        for i in range(0, len(keys), 500):
            for d in self.db["articles"].find({"_id": {"$in": keys[i:i + 500]}}, {"qid": 1}):
                out[d["_id"]] = d.get("qid")
        return out

    def attach_alerts(self):
        alerts = list(self.db["alerts"].find({"event_id": {"$exists": False}, "invalid": {"$ne": True}}).sort([("window_end", 1), ("_id", 1)]))
        if not alerts:
            return set(), 0, 0
        qids = self.article_qids({(a["lang"], a["title"]) for a in alerts})
        events = {d["_id"]: d for d in self.db["events"].find({"kind": "detected"},
                                                              {"key": 1, "last_activity": 1, "first_seen": 1})}
        by_key = defaultdict(list)
        for ev in events.values():
            by_key[ev["key"]].append(ev)
        touched, attached, created = set(), 0, 0
        for al in alerts:
            key = qids.get(f"{al['lang']}:{al['title']}") or f"{al['lang']}:{al['title']}"
            target = None
            for ev in sorted(by_key.get(key, []), key=lambda e: e["first_seen"]):
                if _as_utc(ev["last_activity"]) >= _as_utc(al["window_start"]) - self.merge:
                    target = ev
                    break
            art = {"lang": al["lang"], "title": al["title"]}
            if target is None:
                eid = str(al["_id"])
                doc = {
                    "_id": eid, "key": key, "qid": key if QID_RE.match(key) else None, "kind": "detected",
                    "theme": "autres", "theme_source": themes.SRC_UNKNOWN, "theme_confidence": 0.0,
                    "titles": {}, "articles": [art], "description": None, "thumbnail_url": None,
                    "first_seen": al["window_start"], "last_activity": al["window_end"],
                    "peak_z": al["z_score"], "peak_at": al["window_end"], "langs": [al["lang"]],
                    "total_edits": al["edits"], "distinct_users": al["distinct_users"],
                    "alerts_count": 1, "alert_ids": [eid], "spark": [], "status": "terminé",
                    "significance": 0.0, "lead_eligible": False, "updated_at": utcnow()}
                try:
                    self.db["events"].insert_one(doc)
                except DuplicateKeyError:
                    pass  # created by a concurrent run (deterministic id): fine
                events[eid] = doc
                by_key[key].append(doc)
                target = doc
                created += 1
            else:
                self.db["events"].update_one({"_id": target["_id"]}, {
                    "$addToSet": {"articles": art, "alert_ids": str(al["_id"])},
                    "$max": {"last_activity": al["window_end"]}})
                target["last_activity"] = max(_as_utc(target["last_activity"]), _as_utc(al["window_end"]))
                attached += 1
            self.db["alerts"].update_one({"_id": al["_id"]}, {"$set": {"event_id": str(target["_id"])}})
            touched.add(str(target["_id"]))
        if alerts:
            log.info("attached %d alert(s): %d new event(s), %d added to existing ones", len(alerts), created, attached)
        return touched, attached, created

    # ---------------------------------------------------------------- 2. rekey
    def rekey(self, touched: set):
        evs = self.db["events"]
        todo = list(evs.find({"kind": "detected", "key": {"$not": QID_RE}}, {"articles": 1, "key": 1,
                                                                             "first_seen": 1, "last_activity": 1}))
        merged = rekeyed = 0
        for ev in todo:
            qids = self.article_qids([(a["lang"], a["title"]) for a in ev.get("articles", [])])
            qid = next((q for q in qids.values() if q), None)
            if not qid:
                continue
            rekeyed += 1
            others = [o for o in evs.find({"kind": "detected", "key": qid, "_id": {"$ne": ev["_id"]}},
                                          {"first_seen": 1, "last_activity": 1, "articles": 1, "alert_ids": 1})
                      if _as_utc(o["last_activity"]) >= _as_utc(ev["first_seen"]) - self.merge
                      and _as_utc(ev["last_activity"]) >= _as_utc(o["first_seen"]) - self.merge]
            if not others:
                evs.update_one({"_id": ev["_id"]}, {"$set": {"key": qid, "qid": qid}})
                touched.add(str(ev["_id"]))
                continue
            group = sorted(others + [ev], key=lambda e: e["first_seen"])
            keep = group[0]
            for src in group[1:]:
                full = evs.find_one({"_id": src["_id"]})
                evs.update_one({"_id": keep["_id"]}, {
                    "$addToSet": {"articles": {"$each": full.get("articles", [])},
                                  "alert_ids": {"$each": full.get("alert_ids", [])}},
                    "$min": {"first_seen": full["first_seen"]}, "$max": {"last_activity": full["last_activity"]}})
                self.db["alerts"].update_many({"event_id": str(src["_id"])}, {"$set": {"event_id": str(keep["_id"])}})
                evs.delete_one({"_id": src["_id"]})  # the only delete allowed: a merged event doc
                touched.discard(str(src["_id"]))
                merged += 1
                log.info("merged event %s into %s (same qid %s)", src["_id"], keep["_id"], qid)
            evs.update_one({"_id": keep["_id"]}, {"$set": {"key": qid, "qid": qid}})
            touched.add(str(keep["_id"]))
        return merged, rekeyed

    # -------------------------------------------------------------- 3. refresh
    def refresh(self, ref, touched: set) -> int:
        evs = self.db["events"]
        cut = ref - self.merge
        query = {"kind": "detected", "$or": [
            {"_id": {"$in": sorted(touched)}}, {"last_activity": {"$gte": cut}},
            {"significance": {"$exists": False}}, {"theme_source": themes.SRC_UNKNOWN}]}
        n = 0
        for ev in list(evs.find(query)):
            try:
                self.refresh_one(ev, ref)
                n += 1
            except Exception:  # noqa: BLE001
                log.exception("could not refresh event %s", ev.get("_id"))
        return n

    def refresh_one(self, ev, ref):
        db = self.db
        alerts = list(db["alerts"].find({"event_id": str(ev["_id"])}).sort([("window_end", 1), ("_id", 1)]))
        if not alerts:
            return
        arts, seen = [], set()
        for al in alerts:
            if (al["lang"], al["title"]) not in seen:
                seen.add((al["lang"], al["title"]))
                arts.append({"lang": al["lang"], "title": al["title"]})
        qids = self.article_qids([(a["lang"], a["title"]) for a in arts])
        qid = ev.get("qid") or next((q for q in qids.values() if q), None)
        sitelinks = {}
        if qid:
            ent = db["wikidata_entities"].find_one({"_id": qid}, {"sitelinks": 1})
            sitelinks = {SITE_TO_LANG[k]: v for k, v in (ent or {}).get("sitelinks", {}).items() if k in SITE_TO_LANG}
        titles = dict(sitelinks)
        for a in arts:
            titles.setdefault(a["lang"], a["title"])
        titles = {lg: titles[lg] for lg in ("ar", "fr", "en") if lg in titles}
        watch = list(dict.fromkeys([(a["lang"], a["title"]) for a in arts] + [(lg, t) for lg, t in sitelinks.items()]))

        first_seen = min(a["window_start"] for a in alerts)
        since = first_seen - timedelta(hours=1)
        pipe = [{"$match": {"bot": False, "timestamp": {"$gte": since},
                            "$or": [{"lang": lg, "title": t} for lg, t in watch]}},
                {"$facet": {
                    "tot": [{"$group": {"_id": None, "n": {"$sum": 1}, "users": {"$addToSet": "$user"},
                                        "last": {"$max": "$timestamp"}}}],
                    "langs": [{"$group": {"_id": "$lang"}}],
                    "hours": [{"$group": {"_id": {"$dateTrunc": {"date": "$timestamp", "unit": "hour"}},
                                          "n": {"$sum": 1}}}]}}]
        res = next(iter(db["edits"].aggregate(pipe, allowDiskUse=True)), {})
        tot = (res.get("tot") or [None])[0]
        peak = max(alerts, key=lambda a: a["z_score"])
        if tot:
            last_activity = _as_utc(tot["last"])
            langs = [lg for lg in ("ar", "fr", "en") if lg in {r["_id"] for r in res["langs"]}]
            total_edits, users = tot["n"], len(tot["users"])
            hours = {_as_utc(r["_id"]): r["n"] for r in res["hours"]}
        else:  # edits not found (should not happen): fall back on the alerts themselves
            last_activity = _as_utc(alerts[-1]["window_end"])
            langs = sorted({a["lang"] for a in alerts})
            total_edits = sum(a["edits"] for a in alerts)
            users = max(a["distinct_users"] for a in alerts)
            hours = {}
        end_hour = last_activity.replace(minute=0, second=0, microsecond=0)
        spark = [{"t": end_hour - timedelta(hours=23 - i), "edits": hours.get(end_hour - timedelta(hours=23 - i), 0)}
                 for i in range(24)]

        docs = {d["_id"]: d for d in db["articles"].find({"_id": {"$in": [f"{lg}:{t}" for lg, t in watch]}})}
        ordered = [docs[f"{lg}:{t}"] for lg, t in watch if f"{lg}:{t}" in docs]
        best = None
        for d in ordered:  # best confidence; ties -> the first alerted article (list order)
            if best is None or (d.get("theme_confidence") or 0) > (best.get("theme_confidence") or 0):
                best = d
        if best:
            theme, tsrc, tconf = best["theme"], best["theme_source"], best.get("theme_confidence", 0.0)
        else:
            theme, tsrc, tconf = "autres", themes.SRC_UNKNOWN, 0.0
        by_lang = {lg: [d for d in ordered if d["lang"] == lg] for lg in LANG_PREF}
        description = next((d["description"] for lg in LANG_PREF for d in by_lang[lg] if d.get("description")), None)
        thumb = next((d["thumbnail_url"] for lg in LANG_PREF for d in by_lang[lg] if d.get("thumbnail_url")), None)

        status = "en cours" if last_activity >= _as_utc(ref) - self.active else "terminé"
        update = {
            "key": qid or ev["key"], "qid": qid, "theme": theme, "theme_source": tsrc, "theme_confidence": tconf,
            "titles": titles, "articles": arts, "description": description, "thumbnail_url": thumb,
            "first_seen": first_seen, "last_activity": last_activity, "peak_z": peak["z_score"],
            "peak_at": peak["window_end"], "langs": langs, "total_edits": total_edits, "distinct_users": users,
            "alerts_count": len(alerts), "alert_ids": [str(a["_id"]) for a in alerts], "spark": spark,
            "status": status, "significance": significance(peak["z_score"], users, len(langs)),
            "lead_eligible": lead_eligible(users, len(langs), total_edits, theme), "updated_at": utcnow()}
        db["events"].update_one({"_id": ev["_id"]}, {"$set": update})

    # --------------------------------------------------------------- 4. status
    def close_old(self, ref):
        self.db["events"].update_many(
            {"kind": "detected", "status": "en cours", "last_activity": {"$lt": _as_utc(ref) - self.active}},
            {"$set": {"status": "terminé", "updated_at": utcnow()}})

    # ------------------------------------------------------------ 5. historical
    def _wikidata_api(self):
        if self._api is None:
            from .enricher import Api
            self._api = Api(env_float("ENRICH_RATE_PER_SEC", 5))
        return self._api

    def _hist_qid(self):
        doc = self.db["events"].find_one({"_id": HIST_ID}, {"qid": 1})
        if doc and doc.get("qid"):
            return doc["qid"]
        art = self.db["articles"].find_one({"_id": f"en:{HIST_EN_TITLE}"}, {"qid": 1})
        if art and art.get("qid"):
            return art["qid"]
        return None

    def ensure_historical(self):
        """Upsert the 2023 Al Haouz earthquake event from the REAL pageviews (idempotent)."""
        from .enricher import SITES, WIKIDATA_API, parse_entity

        db = self.db
        try:
            qid = self._hist_qid()
            if qid is None:
                data = self._wikidata_api().get(WIKIDATA_API, {
                    "action": "wbgetentities", "format": "json", "sites": "enwiki", "titles": HIST_EN_TITLE,
                    "props": "claims|labels|sitelinks", "languages": "fr|en", "sitefilter": SITES, "normalize": 1})
                ents = {k: v for k, v in data.get("entities", {}).items() if k.startswith("Q")}
                if not ents:
                    raise RuntimeError(f"Wikidata has no item for enwiki:{HIST_EN_TITLE}")
                qid, ent = next(iter(ents.items()))
                doc = parse_entity(qid, ent, utcnow())
                db["wikidata_entities"].replace_one({"_id": qid}, doc, upsert=True)
                log.info("historical event: qid %s found through the Wikidata API (sitelink enwiki:%s)", qid, HIST_EN_TITLE)
            ent = db["wikidata_entities"].find_one({"_id": qid})
            if ent is None:
                from .enricher import WIKIDATA_API as API
                data = self._wikidata_api().get(API, {"action": "wbgetentities", "format": "json", "ids": qid,
                                                      "props": "claims|labels|sitelinks", "languages": "fr|en",
                                                      "sitefilter": SITES})
                ent = parse_entity(qid, data["entities"][qid], utcnow())
                db["wikidata_entities"].replace_one({"_id": qid}, ent, upsert=True)
            titles = {SITE_TO_LANG[k]: v for k, v in ent.get("sitelinks", {}).items() if k in SITE_TO_LANG}
            for lg, t in REPLAY_TITLES.items():
                if titles.get(lg) != t:
                    log.warning("historical event: sitelink %s=%r differs from the replay title %r", lg, titles.get(lg), t)
                titles.setdefault(lg, t)
            # theme from the real P31 of the item (earthquake) through the same classifier
            res = themes.classify(self.mapping, lang="en", title=HIST_EN_TITLE, p31=ent.get("p31", []),
                                  p106=[], has_qid=True)
            if res.theme != "catastrophes":
                log.warning("historical event: classifier says %s (%s), contract wants catastrophes", res.theme, res.reason)
            wl = json.loads((Path(__file__).resolve().parent.parent / "config" / "watchlist.json").read_text("utf-8"))
            or_terms = [{"lang": lg, "title": {"$in": wl[lg]}} for lg in ("ar", "fr", "en")]
            hours = {}
            for r in db["pageviews"].aggregate([{"$match": {"$or": or_terms}},
                                                {"$group": {"_id": "$hour", "v": {"$sum": "$views"}}}, {"$sort": {"_id": 1}}]):
                hours[_as_utc(r["_id"])] = r["v"]
            if not hours:
                raise RuntimeError("no pageviews rows for the Al Haouz titles")
            peak_hour = max(hours, key=hours.get)
            active_hours = [h for h, v in sorted(hours.items()) if v > 0]
            arts = [{"lang": lg, "title": REPLAY_TITLES[lg]} for lg in ("ar", "fr", "en")]
            adocs = {d["_id"]: d for d in db["articles"].find({"_id": {"$in": [f"{a['lang']}:{a['title']}" for a in arts]}})}
            description = next((adocs[f"{lg}:{REPLAY_TITLES[lg]}"]["description"] for lg in LANG_PREF
                                if adocs.get(f"{lg}:{REPLAY_TITLES[lg]}", {}).get("description")), None)
            thumb = next((adocs[f"{lg}:{REPLAY_TITLES[lg]}"]["thumbnail_url"] for lg in LANG_PREF
                          if adocs.get(f"{lg}:{REPLAY_TITLES[lg]}", {}).get("thumbnail_url")), None)
            event = {
                "key": qid, "qid": qid, "kind": "historique", "theme": "catastrophes",
                "theme_source": res.source, "theme_confidence": res.confidence,
                "titles": {lg: titles[lg] for lg in ("ar", "fr", "en")}, "articles": arts,
                "description": description, "thumbnail_url": thumb, "first_seen": HIST_FIRST_SEEN,
                "last_activity": active_hours[-1], "peak_z": None, "peak_at": peak_hour,
                "peak_views": hours[peak_hour], "total_views": sum(hours.values()), "pageviews_hours": len(hours),
                "langs": ["ar", "fr", "en"], "total_edits": 0, "distinct_users": 0, "alerts_count": 0,
                "alert_ids": [], "spark": [], "status": "historique", "significance": 50.0, "lead_eligible": True,
                "updated_at": utcnow()}
            db["events"].update_one({"_id": HIST_ID}, {"$set": event}, upsert=True)
            self._hist_done = time_now()
            log.info("historical event %s: qid=%s peak=%d views at %s, total=%d views over %d loaded hours",
                     HIST_ID, qid, event["peak_views"], peak_hour.strftime("%Y-%m-%dT%H:%MZ"), event["total_views"], len(hours))
        except Exception as exc:  # noqa: BLE001 - retried in 10 minutes; never blocks the detector
            self._hist_done = time_now()
            log.error("historical event not updated: %s", exc)


def time_now() -> float:
    import time
    return time.monotonic()


def time_since(t0: float) -> float:
    return time_now() - t0 if t0 else float("inf")
