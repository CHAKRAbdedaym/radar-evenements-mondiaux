"""enricher: Wikipedia + Wikidata -> `articles` (theme for every article), cache in `wikidata_entities`.

See docs/CONTRACT.md sections 5.7, 5.8 and 6 ("enricher (v2)"). One loop:
  1. build a priority queue of (lang, title) not yet in `articles` (0 alerts/events, 1 radar,
     2 >= 2 human edits in 24 h, 3 the rest of the edits, 4 pageviews top 200 + watchlist);
  2. take <= ENRICH_BATCH_SIZE titles of ONE language, ask Wikipedia (pageprops, pageimages,
     description, categories), then Wikidata (claims, labels, sitelinks) for the qids and for the
     P31 / P106 class items that are not cached yet;
  3. classify with themes.classify and upsert into `articles`.
Every Wikimedia call goes through one rate limiter (ENRICH_RATE_PER_SEC), sends the User-Agent and
honours 429 / Retry-After. A failed batch is logged and retried later, never marked as enriched.

CLI:  python -m radar_ingest.enricher                # the service loop
      python -m radar_ingest.enricher --reclassify   # re-run the classification from the cache only (no fetch)
"""
import argparse
import json
import time
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from pymongo import ReplaceOne, UpdateOne
from pymongo.errors import PyMongoError

from . import common, themes
from .common import STOP, env_float, env_int, get_logger, utcnow

log = get_logger("enricher")

STATUS_ID = "enricher"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
WIKIPEDIA_API = "https://{lang}.wikipedia.org/w/api.php"
SITES = "arwiki|frwiki|enwiki"
P0_POLL_SECONDS = 15          # look for new alert / event articles this often (priority 0 fast path)
REQUEUE_SECONDS = 60          # rebuild the queue at least this often (new alerts / edits arrive all the time)
MAX_CONTINUE = 12             # follow Wikipedia `continue` at most this many times per batch
MAX_CATEGORIES = 80           # categories kept per article
MAX_OCCUPATIONS = 8
MAX_CLASSES = 10              # P31 values kept per article
PAGEVIEWS_TOP = 200
LANGS = ("ar", "fr", "en")
SKIP_NAMESPACES = {
    "wikipedia", "wikipédia", "ويكيبيديا", "category", "catégorie", "تصنيف", "template", "modèle", "قالب",
    "file", "fichier", "ملف", "help", "aide", "مساعدة", "portal", "portail", "بوابة", "talk", "discussion",
    "نقاش", "user", "utilisateur", "مستخدم", "special", "spécial", "خاص", "mediawiki", "draft", "projet",
    "module", "wp", "image"}
MAIN_PAGES = {"Main Page", "Wikipédia:Accueil principal", "الصفحة الرئيسية", "-"}


class Stopped(Exception):
    """Raised when SIGTERM arrives in the middle of a batch."""


class ApiError(Exception):
    pass


# ------------------------------------------------------------------ HTTP layer
class Api:
    """Rate-limited Wikimedia client shared by the Wikipedia and Wikidata calls."""

    def __init__(self, rate_per_sec: float):
        self.session = common.make_session()
        self.interval = 1.0 / max(rate_per_sec, 0.1)
        self.next_slot = 0.0
        self.calls = 0

    def _throttle(self):
        now = time.monotonic()
        delay = self.next_slot - now
        if delay > 0 and STOP.wait(delay):
            raise Stopped()
        self.next_slot = max(now, self.next_slot) + self.interval

    def get(self, url: str, params: dict) -> dict:
        last = "unknown error"
        for attempt in range(5):
            if STOP.is_set():
                raise Stopped()
            self._throttle()
            self.calls += 1
            try:
                resp = self.session.get(url, params=params, timeout=90)
            except requests.RequestException as exc:
                last = f"network error: {exc.__class__.__name__}"
                log.warning("%s on %s (attempt %d)", last, url.split("/")[2], attempt + 1)
                if STOP.wait(min(2 ** attempt * 2, 30)):
                    raise Stopped()
                continue
            if resp.status_code == 429:
                wait = common.parse_retry_after(resp, default=30.0 * (attempt + 1))
                last = "HTTP 429"
                log.warning("429 from %s, sleeping %.0f s", url.split("/")[2], wait)
                if STOP.wait(wait):
                    raise Stopped()
                continue
            if resp.status_code >= 500:
                last = f"HTTP {resp.status_code}"
                log.warning("%s from %s (attempt %d)", last, url.split("/")[2], attempt + 1)
                if STOP.wait(min(2 ** attempt * 3, 60)):
                    raise Stopped()
                continue
            if resp.status_code >= 400:
                raise ApiError(f"HTTP {resp.status_code} from {url.split('/')[2]}")
            try:
                data = resp.json()
            except ValueError:
                last = "invalid JSON"
                if STOP.wait(min(2 ** attempt * 2, 30)):
                    raise Stopped()
                continue
            err = data.get("error")
            if err:
                code = err.get("code", "")
                if code in ("ratelimited", "maxlag", "internal_api_error_DBConnectionError", "readonly"):
                    last = f"api error {code}"
                    if STOP.wait(15 * (attempt + 1)):
                        raise Stopped()
                    continue
                raise ApiError(f"api error {code}: {err.get('info', '')}")
            return data
        raise ApiError(f"giving up after retries ({last})")


# ------------------------------------------------------------- Wikipedia parsing
def strip_category_prefix(title: str) -> str:
    return title.split(":", 1)[1].strip() if ":" in title else title


def wikipedia_batch(api: Api, lang: str, titles: list[str]) -> dict[str, dict | None]:
    """Return {requested title: page dict | None}. Redirects and normalisation are mapped back."""
    params = {
        "action": "query", "format": "json", "formatversion": 2, "redirects": 1,
        "prop": "pageprops|pageimages|description|categories", "ppprop": "wikibase_item",
        "piprop": "thumbnail", "pithumbsize": 400, "cllimit": "max", "clshow": "!hidden",
        "titles": "|".join(titles)}
    url = WIKIPEDIA_API.format(lang=lang)
    pages: dict = {}
    normalized: dict[str, str] = {}
    redirects: dict[str, str] = {}
    cont: dict = {}
    for _ in range(MAX_CONTINUE):
        data = api.get(url, {**params, **cont})
        query = data.get("query", {})
        for n in query.get("normalized", []):
            normalized[n["from"]] = n["to"]
        for r in query.get("redirects", []):
            redirects[r["from"]] = r["to"]
        for p in query.get("pages", []):
            key = p.get("pageid") or p.get("title")
            cur = pages.setdefault(key, {})
            for k, v in p.items():
                if k == "categories":
                    cur.setdefault("categories", []).extend(v)
                else:
                    cur.setdefault(k, v)
        if "continue" in data:
            cont = data["continue"]
        else:
            break
    else:
        log.warning("wikipedia %s: continue limit reached for a batch of %d titles", lang, len(titles))
    by_title = {p.get("title"): p for p in pages.values()}
    out: dict[str, dict | None] = {}
    for t in titles:
        cur = normalized.get(t, t)
        for _ in range(6):  # follow redirect chains
            if cur in redirects:
                cur = redirects[cur]
            else:
                break
        out[t] = by_title.get(cur)
    return out


# -------------------------------------------------------------- Wikidata parsing
def _statements(claims: dict, prop: str) -> list[dict]:
    """Non-deprecated statements, preferred rank first (stable)."""
    sts = [s for s in claims.get(prop, []) if s.get("rank") != "deprecated"]
    return sorted(sts, key=lambda s: 0 if s.get("rank") == "preferred" else 1)


def _entity_ids(claims: dict, prop: str) -> list[str]:
    out = []
    for s in _statements(claims, prop):
        snak = s.get("mainsnak", {})
        if snak.get("snaktype") != "value":
            continue
        val = snak.get("datavalue", {}).get("value")
        if isinstance(val, dict) and val.get("id") and val["id"] not in out:
            out.append(val["id"])
    return out


def _parse_time(claims: dict, prop: str) -> datetime | None:
    for s in _statements(claims, prop):
        snak = s.get("mainsnak", {})
        if snak.get("snaktype") != "value":
            continue
        raw = snak.get("datavalue", {}).get("value", {}).get("time")
        if not raw or raw.startswith("-"):
            continue
        raw = raw.lstrip("+").replace("-00-", "-01-").replace("-00T", "-01T")
        try:
            return datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def parse_entity(qid: str, ent: dict, now: datetime) -> dict:
    """wbgetentities entity -> `wikidata_entities` document (contract 5.8)."""
    if "missing" in ent:
        return {"_id": qid, "missing": True, "label_fr": None, "label_en": None, "p31": [], "p279": [],
                "p106": [], "p570": None, "sitelinks": {}, "fetched_at": now}
    claims = ent.get("claims", {})
    labels = ent.get("labels", {})
    sitelinks = {}
    for site, link in (ent.get("sitelinks") or {}).items():
        if site in ("arwiki", "frwiki", "enwiki") and link.get("title"):
            sitelinks[site] = link["title"]
    return {
        "_id": qid,
        "label_fr": (labels.get("fr") or {}).get("value"),
        "label_en": (labels.get("en") or {}).get("value"),
        "p31": _entity_ids(claims, "P31"), "p279": _entity_ids(claims, "P279"),
        "p106": _entity_ids(claims, "P106"), "p570": _parse_time(claims, "P570"),
        "sitelinks": sitelinks, "fetched_at": now}


def entity_label(doc: dict | None) -> str | None:
    if not doc:
        return None
    return doc.get("label_fr") or doc.get("label_en")


# ------------------------------------------------------------------- enricher
class Enricher:
    def __init__(self):
        self.db = common.get_db()
        self.articles = self.db["articles"]
        self.entities = self.db["wikidata_entities"]
        self.batch_size = max(1, min(env_int("ENRICH_BATCH_SIZE", 50), 50))
        self.rate = env_float("ENRICH_RATE_PER_SEC", 5)
        self.idle = env_int("ENRICH_INTERVAL_SECONDS", 20)
        self.refresh_days = env_int("ENRICH_REFRESH_DAYS", 7)
        self.window = timedelta(minutes=env_int("WINDOW_MINUTES", 5))
        self.mapping = themes.load_mapping()
        self.api = None
        self.queue: list[dict[str, deque]] = [defaultdict(deque) for _ in range(5)]
        self.retry: dict[str, tuple[float, int]] = {}   # key -> (not before monotonic, attempts)
        self.stats = Counter()
        self.processed: set[str] = set()   # keys enriched since the last queue rebuild (skip queued duplicates)
        self.p0_seen: set[str] = set()     # keys already pushed by the priority-0 fast path
        self.ref_time: datetime | None = None

    # -- setup
    def ensure_indexes(self):
        a, e = self.articles, self.entities
        a.create_index([("theme", 1)])
        a.create_index([("qid", 1)])
        a.create_index([("theme_source", 1)])
        a.create_index([("enriched_at", 1)])
        a.create_index([("lang", 1), ("theme", 1)])
        e.create_index([("fetched_at", 1)])
        log.info("indexes ensured on articles and wikidata_entities")

    # -- queue
    def build_queue(self):
        db = self.db
        ref = common.latest_event_time(db)
        self.ref_time = ref
        now_m = time.monotonic()
        existing = {d["_id"]: d.get("enriched_at") for d in self.articles.find({}, {"enriched_at": 1})}
        stale_before = utcnow() - timedelta(days=self.refresh_days)
        queue: list[list] = [[] for _ in range(5)]
        seen: set[str] = set()

        def add(prio: int, lang: str, title: str, active: bool):
            if lang not in LANGS or not title:
                return
            key = f"{lang}:{title}"
            if key in seen:
                return
            enriched = existing.get(key)
            if enriched is not None:
                if enriched.tzinfo is None:
                    enriched = enriched.replace(tzinfo=timezone.utc)
                if not (active and enriched < stale_before):
                    return
            if self.retry.get(key, (0, 0))[0] > now_m:
                return
            seen.add(key)
            queue[prio].append((lang, title))

        # 0: alerts, then events
        for r in db["alerts"].aggregate([{"$group": {"_id": {"lang": "$lang", "title": "$title"},
                                                     "t": {"$max": "$created_at"}}}, {"$sort": {"t": -1}}]):
            add(0, r["_id"]["lang"], r["_id"]["title"], True)
        if "events" in db.list_collection_names():
            for ev in db["events"].find({}, {"articles": 1}).sort("last_activity", -1):
                for art in ev.get("articles", []):
                    add(0, art.get("lang"), art.get("title"), True)
        if ref is not None:
            # 1: radar window
            for r in db["edits"].aggregate([
                    {"$match": {"bot": False, "timestamp": {"$gte": ref - self.window, "$lte": ref}}},
                    {"$group": {"_id": {"lang": "$lang", "title": "$title"}, "n": {"$sum": 1}}},
                    {"$sort": {"n": -1}}], allowDiskUse=True):
                add(1, r["_id"]["lang"], r["_id"]["title"], True)
            # 2: >= 2 non-bot edits in the last 24 h
            for r in db["edits"].aggregate([
                    {"$match": {"bot": False, "timestamp": {"$gte": ref - timedelta(hours=24), "$lte": ref}}},
                    {"$group": {"_id": {"lang": "$lang", "title": "$title"}, "n": {"$sum": 1}}},
                    {"$match": {"n": {"$gte": 2}}}, {"$sort": {"n": -1}}], allowDiskUse=True):
                add(2, r["_id"]["lang"], r["_id"]["title"], True)
        # 3: the rest of the edits, most recently edited first
        for r in db["edits"].aggregate([
                {"$group": {"_id": {"lang": "$lang", "title": "$title"}, "t": {"$max": "$timestamp"}}},
                {"$sort": {"t": -1}}], allowDiskUse=True):
            add(3, r["_id"]["lang"], r["_id"]["title"], False)
        # 4: pageviews top per (lang, hour) + watchlist
        for lang, title in self._pageview_candidates():
            add(4, lang, title, False)

        self.queue = [defaultdict(deque) for _ in range(5)]
        self.processed.clear()
        self.p0_seen.clear()
        seq = 0
        for prio, items in enumerate(queue):
            for lang, title in items:
                self.queue[prio][lang].append((seq, title))
                seq += 1
        counts = [len(q) for q in queue]
        log.info("queue rebuilt: p0=%d p1=%d p2=%d p3=%d p4=%d (already enriched: %d, ref_time=%s)",
                 *counts, len(existing), ref.strftime("%Y-%m-%dT%H:%MZ") if ref else None)

    def _pageview_candidates(self):
        out = []
        pv = self.db["pageviews"]
        try:
            hours = pv.distinct("hour")
            for hour in sorted(hours):
                for lang in LANGS:
                    cur = pv.find({"hour": hour, "lang": lang}, {"title": 1}).sort("views", -1).limit(PAGEVIEWS_TOP + 40)
                    taken = 0
                    for d in cur:
                        title = d["title"]
                        if self._skip_pageview_title(title):
                            continue
                        out.append((lang, title))
                        taken += 1
                        if taken >= PAGEVIEWS_TOP:
                            break
        except PyMongoError as exc:
            log.warning("pageviews candidates failed: %s", exc)
        wl = Path(__file__).resolve().parent.parent / "config" / "watchlist.json"
        try:
            data = json.loads(wl.read_text(encoding="utf-8"))
            for lang in LANGS:
                for title in data.get(lang, []):
                    out.append((lang, title))
        except (OSError, ValueError) as exc:
            log.warning("watchlist not read: %s", exc)
        return out

    @staticmethod
    def _skip_pageview_title(title: str) -> bool:
        if title in MAIN_PAGES:
            return True
        if ":" in title and title.split(":", 1)[0].strip().lower() in SKIP_NAMESPACES:
            return True
        return False

    def refresh_p0(self):
        """Fast path: alert / event articles that are not enriched yet go to the FRONT of priority 0,
        without waiting for the next full queue rebuild (events get their qid and theme within a cycle)."""
        db = self.db
        pairs: list[tuple[str, str]] = []
        for r in db["alerts"].aggregate([{"$group": {"_id": {"lang": "$lang", "title": "$title"}}}]):
            pairs.append((r["_id"]["lang"], r["_id"]["title"]))
        if "events" in db.list_collection_names():
            for ev in db["events"].find({}, {"articles": 1, "titles": 1}):
                pairs += [(a.get("lang"), a.get("title")) for a in ev.get("articles", [])]
                pairs += [(lg, t) for lg, t in (ev.get("titles") or {}).items()]
        pairs = [(lg, t) for lg, t in dict.fromkeys(pairs) if lg in LANGS and t and f"{lg}:{t}" not in self.p0_seen]
        if not pairs:
            return 0
        known = set()
        keys = [f"{lg}:{t}" for lg, t in pairs]
        for i in range(0, len(keys), 500):
            known.update(d["_id"] for d in self.articles.find({"_id": {"$in": keys[i:i + 500]}}, {"_id": 1}))
        now_m = time.monotonic()
        added = 0
        for lg, t in pairs:
            key = f"{lg}:{t}"
            self.p0_seen.add(key)
            if key in known or key in self.processed or self.retry.get(key, (0, 0))[0] > now_m:
                continue
            self.queue[0][lg].appendleft((-1, t))
            added += 1
        if added:
            log.info("priority 0 fast path: %d alert/event article(s) queued first", added)
        return added

    def queue_sizes(self) -> list[int]:
        return [sum(len(d) for d in q.values()) for q in self.queue]

    def next_batch(self):
        """<= batch_size titles of one language, highest priority first (spills to lower priorities to fill the batch)."""
        for prio in range(5):
            heads = [(d[0][0], lang) for lang, d in self.queue[prio].items() if d]
            if not heads:
                continue
            lang = min(heads)[1]
            titles: list[str] = []
            for p in range(prio, 5):
                d = self.queue[p].get(lang)
                while d and len(titles) < self.batch_size:
                    t = d.popleft()[1]
                    if f"{lang}:{t}" not in self.processed:
                        titles.append(t)
                if len(titles) >= self.batch_size:
                    break
            return lang, titles
        return None

    # -- Wikidata cache
    def ensure_entities(self, qids, fetched_now: list) -> dict[str, dict]:
        """Return {qid: doc} for all qids; fetch + cache what is missing (never refetch a cached item)."""
        qids = sorted({q for q in qids if q})
        docs: dict[str, dict] = {}
        for i in range(0, len(qids), 500):
            for d in self.entities.find({"_id": {"$in": qids[i:i + 500]}}):
                docs[d["_id"]] = d
        todo = [q for q in qids if q not in docs]
        for i in range(0, len(todo), self.batch_size):
            chunk = todo[i:i + self.batch_size]
            data = self.api.get(WIKIDATA_API, {
                "action": "wbgetentities", "format": "json", "ids": "|".join(chunk),
                "props": "claims|labels|sitelinks", "languages": "fr|en", "sitefilter": SITES})
            now = utcnow()
            new_docs = []
            for q in chunk:
                ent = data.get("entities", {}).get(q)
                # an item absent from the answer is cached as "missing" so it is never asked twice
                new_docs.append(parse_entity(q, ent if ent is not None else {"missing": ""}, now))
            if new_docs:
                self.entities.bulk_write([ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in new_docs], ordered=False)
                for d in new_docs:
                    docs[d["_id"]] = d
                fetched_now.append(len(new_docs))
        return docs

    # -- classification helpers
    def recent_texts(self, lang: str, title: str):
        comments, texts = [], []
        for d in self.db["edits"].find({"lang": lang, "title": title}, {"comment": 1}).sort("timestamp", -1).limit(8):
            if d.get("comment"):
                comments.append(d["comment"])
        for d in self.db["edit_texts"].find({"lang": lang, "title": title}, {"added_text": 1, "comment": 1}) \
                .sort("timestamp", -1).limit(5):
            if d.get("added_text"):
                texts.append(d["added_text"])
            if d.get("comment"):
                comments.append(d["comment"])
        return comments, texts

    def classify_article(self, *, lang, title, p31, p106, p570, parents, labels, categories, qid) -> themes.Classification:
        res = themes.classify(self.mapping, lang=lang, title=title, p31=p31, p106=p106, p570=p570,
                              ref_time=self.ref_time, parents=parents, labels=labels, categories=categories,
                              has_qid=bool(qid))
        if res.reason == themes.NO_EVIDENCE:  # nothing yet: look at the latest edit comments / added texts
            comments, texts = self.recent_texts(lang, title)
            if comments or texts:
                res = themes.classify(self.mapping, lang=lang, title=title, p31=p31, p106=p106, p570=p570,
                                      ref_time=self.ref_time, parents=parents, labels=labels,
                                      categories=categories, comments=comments, texts=texts, has_qid=bool(qid))
        return res

    # -- one batch
    def process_batch(self, lang: str, titles: list[str]):
        calls_before = self.api.calls
        pages = wikipedia_batch(self.api, lang, titles)
        qids = {(p.get("pageprops") or {}).get("wikibase_item") for p in pages.values() if p}
        qids.discard(None)
        fetched: list[int] = []
        ents = self.ensure_entities(qids, fetched)
        class_ids = set()
        for q in qids:
            d = ents.get(q)
            if d:
                class_ids.update(d["p31"][:MAX_CLASSES])
                if themes.HUMAN_QID in d["p31"]:
                    class_ids.update(d["p106"][:MAX_OCCUPATIONS])
        classes = self.ensure_entities(class_ids, fetched)
        labels = {q: entity_label(d) for q, d in classes.items() if entity_label(d)}
        parents = {q: d["p279"] for q, d in classes.items() if d.get("p279")}

        now = utcnow()
        ops, counts, missing, unresolved = [], Counter(), 0, 0
        for title in titles:
            page = pages.get(title)
            key = f"{lang}:{title}"
            if page is None:
                unresolved += 1  # not in the response: never mark as enriched, retry later
                self._defer(key)
                continue
            try:
                doc = self._build_doc(lang, title, page, ents, classes, labels, parents, now)
            except Exception:  # noqa: BLE001 - bad record: log and skip, never crash
                log.exception("could not build article %s", key)
                self._defer(key)
                continue
            if doc["missing"]:
                missing += 1
            counts[doc["theme_source"]] += 1
            ops.append(ReplaceOne({"_id": doc["_id"]}, doc, upsert=True))
            self.retry.pop(key, None)
            self.processed.add(key)
        if ops:
            self.articles.bulk_write(ops, ordered=False)
        self.stats["enriched"] += len(ops)
        self.stats["missing"] += missing
        calls = self.api.calls - calls_before
        totals = {r["_id"]: r["n"] for r in self.articles.aggregate([{"$group": {"_id": "$theme_source", "n": {"$sum": 1}}}])}
        sizes = self.queue_sizes()
        log.info("batch lang=%s size=%d enriched=%d missing=%d unresolved=%d calls=%d wd_fetched=%d queue=p0:%d,p1:%d,p2:%d,p3:%d,p4:%d totals=%s",
                 lang, len(titles), len(ops), missing, unresolved, calls, sum(fetched), *sizes,
                 json.dumps(totals, ensure_ascii=False))

    def _defer(self, key: str):
        attempts = self.retry.get(key, (0, 0))[1] + 1
        self.retry[key] = (time.monotonic() + min(60 * 2 ** (attempts - 1), 3600), attempts)

    def _build_doc(self, lang, title, page, ents, classes, labels, parents, now) -> dict:
        base = {"_id": f"{lang}:{title}", "lang": lang, "title": title, "enriched_at": now}
        if page.get("missing") or page.get("invalid"):
            reason = "titre invalide" if page.get("invalid") else f"page inexistante ou supprimée sur {lang}.wikipedia"
            return {**base, "resolved_title": None, "missing": True, "qid": None, "description": None,
                    "thumbnail_url": None, "categories": [], "instance_of": [], "occupations": [],
                    "death_date": None, "theme": "autres", "theme_source": themes.SRC_UNKNOWN,
                    "theme_confidence": 0.0, "theme_reason": reason}
        qid = (page.get("pageprops") or {}).get("wikibase_item")
        ent = ents.get(qid) if qid else None
        categories = [strip_category_prefix(c["title"]) for c in page.get("categories", [])][:MAX_CATEGORIES]
        p31 = (ent or {}).get("p31", [])[:MAX_CLASSES]
        human = themes.HUMAN_QID in p31
        p106 = (ent or {}).get("p106", [])[:MAX_OCCUPATIONS] if human else []
        p570 = (ent or {}).get("p570") if human else None
        res = self.classify_article(lang=lang, title=title, p31=p31, p106=p106, p570=p570, parents=parents,
                                    labels=labels, categories=categories, qid=qid)
        return {
            **base, "resolved_title": page.get("title"), "missing": False, "qid": qid,
            "description": page.get("description"),
            "thumbnail_url": (page.get("thumbnail") or {}).get("source"),
            "categories": categories,
            "instance_of": [{"qid": q, "label": labels.get(q)} for q in p31],
            "occupations": [{"qid": q, "label": labels.get(q)} for q in p106],
            "death_date": p570,
            "theme": res.theme, "theme_source": res.source, "theme_confidence": res.confidence,
            "theme_reason": res.reason}

    # -- checkpoint
    def checkpoint(self):
        try:
            common.log_upsert(self.db, STATUS_ID, {
                "source": STATUS_ID, "enriched": self.articles.estimated_document_count(),
                "pending": sum(self.queue_sizes()), "errors": self.stats["errors"],
                "missing_pages": self.stats["missing"], "last_batch_at": self.stats.get("last_batch_at"),
                "updated_at": utcnow()})
        except PyMongoError as exc:
            log.warning("checkpoint failed: %s", exc)

    # -- service loop
    def run(self):
        self.api = Api(self.rate)
        self.ensure_indexes()
        log.info("enricher started: batch=%d rate<=%.1f/s refresh=%d d", self.batch_size, self.rate, self.refresh_days)
        last_rebuild = last_p0 = 0.0
        while not STOP.is_set():
            try:
                if time.monotonic() - last_rebuild > REQUEUE_SECONDS or not sum(self.queue_sizes()):
                    self.build_queue()
                    last_rebuild = time.monotonic()
                if time.monotonic() - last_p0 > P0_POLL_SECONDS:
                    self.refresh_p0()
                    last_p0 = time.monotonic()
                batch = self.next_batch()
                if batch is None:
                    self.checkpoint()
                    log.info("queue empty, sleeping %d s", self.idle)
                    STOP.wait(self.idle)
                    last_rebuild = 0.0
                    continue
                lang, titles = batch
                try:
                    self.process_batch(lang, titles)
                    self.stats["last_batch_at"] = utcnow()
                except Stopped:
                    break
                except (ApiError, PyMongoError) as exc:
                    self.stats["errors"] += 1
                    log.error("batch lang=%s size=%d failed, will retry later: %s", lang, len(titles), exc)
                    for t in titles:
                        self._defer(f"{lang}:{t}")
                    STOP.wait(5)
                except Exception:  # noqa: BLE001
                    self.stats["errors"] += 1
                    log.exception("unexpected error in batch lang=%s, will retry later", lang)
                    for t in titles:
                        self._defer(f"{lang}:{t}")
                    STOP.wait(5)
                self.checkpoint()
            except PyMongoError as exc:
                self.stats["errors"] += 1
                log.error("mongo error in enricher loop: %s", exc)
                STOP.wait(10)
        self.checkpoint()
        log.info("enricher stopped")

    # -- re-classification from the cache (no fetch)
    def reclassify(self):
        self.ref_time = common.latest_event_time(self.db)
        total = changed = 0
        before, after = Counter(), Counter()
        cursor = self.articles.find({"missing": {"$ne": True}}).sort("_id", 1).batch_size(500)
        chunk: list[dict] = []

        def flush(docs):
            nonlocal changed
            class_ids = set()
            for d in docs:
                class_ids.update(x["qid"] for x in d.get("instance_of", []))
                class_ids.update(x["qid"] for x in d.get("occupations", []))
            cached = {e["_id"]: e for e in self.entities.find({"_id": {"$in": sorted(class_ids)}})}
            labels = {q: entity_label(e) for q, e in cached.items() if entity_label(e)}
            parents = {q: e["p279"] for q, e in cached.items() if e.get("p279")}
            ops = []
            for d in docs:
                lab = dict(labels)
                for x in d.get("instance_of", []) + d.get("occupations", []):
                    if x.get("label") and x["qid"] not in lab:
                        lab[x["qid"]] = x["label"]
                res = self.classify_article(
                    lang=d["lang"], title=d["title"], p31=[x["qid"] for x in d.get("instance_of", [])],
                    p106=[x["qid"] for x in d.get("occupations", [])], p570=d.get("death_date"),
                    parents=parents, labels=lab, categories=d.get("categories", []), qid=d.get("qid"))
                before[d.get("theme_source")] += 1
                after[res.source] += 1
                new = {"theme": res.theme, "theme_source": res.source, "theme_confidence": res.confidence,
                       "theme_reason": res.reason}
                if any(d.get(k) != v for k, v in new.items()):
                    changed += 1
                    ops.append(UpdateOne({"_id": d["_id"]}, {"$set": new}))
            if ops:
                self.articles.bulk_write(ops, ordered=False)

        for d in cursor:
            total += 1
            chunk.append(d)
            if len(chunk) >= 500:
                flush(chunk)
                chunk = []
        if chunk:
            flush(chunk)
        log.info("reclassify done: %d articles, %d changed; theme_source before=%s after=%s",
                 total, changed, dict(before), dict(after))
        return total, changed


def main():
    parser = argparse.ArgumentParser(description="enricher: Wikipedia + Wikidata -> articles.theme")
    parser.add_argument("--reclassify", action="store_true",
                        help="re-run the classification of stored articles from the cache (no fetch) and exit")
    args = parser.parse_args()
    common.install_signal_handlers(log)
    enricher = Enricher()
    if args.reclassify:
        enricher.reclassify()
        return
    enricher.run()


if __name__ == "__main__":
    main()
