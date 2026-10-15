"""QA: validate every GET endpoint of docs/CONTRACT.md section 7 (shapes, types, edge cases, latency).

Run inside the backend container (stdlib only):
  docker compose exec -T backend python - < qa/api_check.py
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://localhost:8000"
FAIL = []
OK = 0


def get(path, timeout=30):
    t0 = time.time()
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
            body = r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        body = e.read()
        code = e.code
    dt = (time.time() - t0) * 1000
    try:
        data = json.loads(body)
    except Exception:
        data = None
    return code, data, dt, len(body)


def check(name, cond, extra=""):
    global OK
    if cond:
        OK += 1
    else:
        FAIL.append(f"{name} {extra}")
        print("  FAIL:", name, extra)


ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")


def iso(v):
    return isinstance(v, str) and bool(ISO.match(v))


def isint(v):
    return isinstance(v, int) and not isinstance(v, bool)


def isnum(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def shape(name, obj, spec):
    """spec: {key: checker or 'null|checker'}"""
    check(name + " is dict", isinstance(obj, dict), repr(obj)[:100])
    if not isinstance(obj, dict):
        return
    for k, fn in spec.items():
        ok_null = False
        if isinstance(fn, tuple):
            fn, ok_null = fn[0], True
        check(f"{name}.{k} present", k in obj, f"keys={list(obj)}")
        if k in obj:
            v = obj[k]
            check(f"{name}.{k} type", (ok_null and v is None) or fn(v), f"value={v!r}"[:100])
    extra = set(obj) - set(spec)
    if extra:
        print(f"  NOTE {name}: extra keys not in spec: {sorted(extra)}")


S = lambda v: isinstance(v, str)
B = lambda v: isinstance(v, bool)
L = lambda v: isinstance(v, list)

edit_item = {"id": S, "title": S, "lang": S, "user": S, "bot": B, "type": S, "timestamp": iso,
             "comment": (S, True), "delta_bytes": isint, "url": S}
alert_item = {"id": S, "lang": S, "title": S, "window_start": iso, "window_end": iso, "edits": isint,
              "distinct_users": isint, "delta_bytes": isint, "baseline_mean": isnum, "baseline_std": isnum,
              "baseline_type": S, "z_score": isnum, "created_at": iso}

timings = {}


def timed(name, path, **kw):
    code, data, dt, size = get(path, **kw)
    timings[name] = (dt, size)
    return code, data


print("== health")
c, d = timed("health", "/api/health")
check("health 200", c == 200)
shape("health", d, {"status": S, "mongo": B, "time": iso})
check("health ok", d and d.get("status") == "ok" and d.get("mongo") is True)

print("== stats")
c, st = timed("stats", "/api/stats")
check("stats 200", c == 200)
shape("stats", st, {"time": iso, "collections": lambda v: isinstance(v, dict), "db": lambda v: isinstance(v, dict),
                    "edits_per_lang": L, "edits_last_minute": isint, "edits_last_hour": isint,
                    "bots": lambda v: isinstance(v, dict), "ingestion_rate_per_min": isint,
                    "active_articles": isint, "active_alerts": isint, "first_edit_at": (iso, True),
                    "last_edit_at": (iso, True), "pageviews_hours_loaded": isint, "ref_time": iso,
                    "server_time": iso, "clock_skew_seconds": isnum})
for col in ["edits", "edit_texts", "pageviews", "alerts", "ingestion_log"]:
    shape("stats.collections." + col, st["collections"].get(col), {"count": isint, "size_bytes": isint, "avg_doc_bytes": isnum})
print("  stats collections keys:", list(st["collections"]))
shape("stats.db", st["db"], {"data_size_bytes": isnum, "storage_size_bytes": isnum, "index_size_bytes": isnum, "total_size_bytes": isnum})
shape("stats.bots", st["bots"], {"bot": isint, "human": isint, "bot_pct": isnum})
for e in st["edits_per_lang"]:
    shape("stats.epl", e, {"lang": S, "count": isint})
check("stats bots sum == edits_last_hour", st["bots"]["bot"] + st["bots"]["human"] == st["edits_last_hour"],
      f'{st["bots"]} vs {st["edits_last_hour"]}')
check("stats epl sum == edits total", sum(e["count"] for e in st["edits_per_lang"]) == st["collections"]["edits"]["count"],
      f'{sum(e["count"] for e in st["edits_per_lang"])} vs {st["collections"]["edits"]["count"]}')

print("== edits/recent")
c, d = timed("edits/recent", "/api/edits/recent")
check("recent 200", c == 200)
shape("recent", d, {"items": L, "ref_time": iso})
check("recent default len 50", len(d["items"]) == 50, len(d["items"]))
for it in d["items"][:5]:
    shape("recent.item", it, edit_item)
check("recent no bots by default", all(not i["bot"] for i in d["items"]))
check("recent sorted desc", [i["timestamp"] for i in d["items"]] == sorted([i["timestamp"] for i in d["items"]], reverse=True))
c, d2 = get("/api/edits/recent?include_bots=true&limit=200")[:2]
check("recent bots limit 200", c == 200 and len(d2["items"]) == 200 and any(i["bot"] for i in d2["items"]))
c, d3, _, _ = get("/api/edits/recent?limit=100000")
print("  recent limit=100000 ->", c, (len(d3["items"]) if c == 200 else d3))
c, d3, _, _ = get("/api/edits/recent?limit=0")
print("  recent limit=0 ->", c, d3 if c != 200 else len(d3["items"]))
c, d3, _, _ = get("/api/edits/recent?limit=-5")
print("  recent limit=-5 ->", c, d3 if c != 200 else len(d3["items"]))
c, d3, _, _ = get("/api/edits/recent?limit=abc")
print("  recent limit=abc ->", c, d3)
c, d3, _, _ = get("/api/edits/recent?lang=xx")
check("recent lang=xx 400", c == 400, f"{c} {d3}")
c, d3, _, _ = get("/api/edits/recent?lang=")
print("  recent lang='' (empty) ->", c, (d3 if c != 200 else len(d3['items'])))
c, d3, _, _ = get("/api/edits/recent?lang=fr")
check("recent lang=fr only fr", c == 200 and all(i["lang"] == "fr" for i in d3["items"]))
c, d3, _, _ = get("/api/edits/recent?lang=FR")
print("  recent lang=FR ->", c, d3 if c != 200 else len(d3["items"]))
c, d3, _, _ = get("/api/edits/recent?include_bots=maybe")
print("  recent include_bots=maybe ->", c, d3 if c != 200 else len(d3["items"]))

print("== edits/top")
c, d = timed("edits/top", "/api/edits/top")
check("top 200", c == 200)
shape("top", d, {"minutes": isint, "items": L})
check("top default minutes 60", d["minutes"] == 60)
for it in d["items"][:5]:
    shape("top.item", it, {"lang": S, "title": S, "edits": isint, "distinct_users": isint, "delta_bytes": isint, "last_edit": iso})
srt = [(-i["edits"], -i["distinct_users"]) for i in d["items"]]
check("top sorted edits desc, users desc", srt == sorted(srt))
check("top default limit 20", len(d["items"]) <= 20)
for q, want in [("minutes=0", 400), ("minutes=1441", 400), ("minutes=1440", 200), ("minutes=1", 200), ("minutes=-1", 400),
                ("limit=101", 400), ("limit=100", 200), ("limit=0", 400), ("minutes=abc", 400), ("lang=zz", 400)]:
    c, dd, _, _ = get("/api/edits/top?" + q)
    check(f"top {q} -> {want}", c == want or (want == 400 and c == 422), f"got {c} {str(dd)[:80]}")
    if c != want:
        pass
    elif want == 400:
        check(f"top {q} detail format", isinstance(dd, dict) and isinstance(dd.get("detail"), str), str(dd)[:100])
c, dd, _, _ = get("/api/edits/top?limit=100000")
print("  top limit=100000 ->", c, str(dd)[:100])

print("== edits/timeline")
for mins, bs in [(60, 60), (180, 60), (181, 300), (1440, 300)]:
    c, d = timed(f"timeline{mins}", f"/api/edits/timeline?minutes={mins}")
    check(f"timeline {mins} 200", c == 200)
    shape("timeline", d, {"minutes": isint, "bucket_seconds": isint, "items": L})
    check(f"timeline {mins} bucket_seconds {bs}", d["bucket_seconds"] == bs, d["bucket_seconds"])
    n = d["minutes"] * 60 // d["bucket_seconds"]
    check(f"timeline {mins} filled buckets (~{n})", abs(len(d["items"]) - n) <= 1, f'{len(d["items"])} vs {n}')
    for it in d["items"][:3]:
        shape("timeline.item", it, {"t": iso, "ar": isint, "fr": isint, "en": isint, "total": isint})
    check(f"timeline {mins} total==sum", all(i["total"] == i["ar"] + i["fr"] + i["en"] for i in d["items"]))
    ts = [i["t"] for i in d["items"]]
    check(f"timeline {mins} sorted unique", ts == sorted(set(ts)))
for q, want in [("minutes=0", 400), ("minutes=1441", 400), ("minutes=abc", 400), ("lang=xx", 400)]:
    c, dd, _, _ = get("/api/edits/timeline?" + q)
    check(f"timeline {q} -> {want}", c in (want, 422) if want == 400 else c == want, f"got {c}")

print("== radar")
c, rd = timed("radar", "/api/radar")
check("radar 200", c == 200)
shape("radar", rd, {"window_minutes": isint, "time": iso, "items": L})
for it in rd["items"][:10]:
    shape("radar.item", it, {"lang": S, "title": S, "edits": isint, "distinct_users": isint, "delta_bytes": isint,
                             "last_edit": iso, "z_score": (isnum, True), "baseline_type": (S, True), "alert": B})
check("radar max 150", len(rd["items"]) <= 150)
e = [i["edits"] for i in rd["items"]]
check("radar sorted edits desc", e == sorted(e, reverse=True))
c, r2, _, _ = get("/api/radar?lang=ar&include_bots=true")
check("radar lang=ar", c == 200 and all(i["lang"] == "ar" for i in r2["items"]))
c, dd, _, _ = get("/api/radar?lang=xx")
check("radar lang=xx 400", c == 400)
check("radar.time == stats.ref_time", rd["time"] == st["ref_time"], f'{rd["time"]} vs {st["ref_time"]}')
print(f"  radar items={len(rd['items'])} stats.active_articles={st['active_articles']}")

print("== alerts")
c, d = timed("alerts", "/api/alerts")
check("alerts 200", c == 200)
shape("alerts", d, {"items": L})
for it in d["items"]:
    shape("alerts.item", it, alert_item)
ca = [i["created_at"] for i in d["items"]]
check("alerts desc", ca == sorted(ca, reverse=True))
c, dd, _, _ = get("/api/alerts?limit=100000")
print("  alerts limit=100000 ->", c, str(dd)[:100] if c != 200 else len(dd["items"]))
c, dd, _, _ = get("/api/alerts?limit=0")
print("  alerts limit=0 ->", c, str(dd)[:100] if c != 200 else len(dd["items"]))
c, dd, _, _ = get("/api/alerts?lang=xx")
check("alerts lang=xx 400", c == 400)
alerts = d["items"]

print("== articles")
c, rcnt = get("/api/edits/top?minutes=1440&limit=3")[:2]
cands = [(i["lang"], i["title"]) for i in rcnt["items"]]
cands += [("ar", t["title"]) for t in []]
c, ar = get("/api/edits/recent?lang=ar&limit=3")[:2]
cands += [(i["lang"], i["title"]) for i in ar["items"]]
for lang, title in cands[:6]:
    p = f"/api/articles/{lang}/{urllib.parse.quote(title, safe='')}"
    c, d = timed("article", p)
    check(f"article {lang}:{title} 200", c == 200, f"{c} {str(d)[:100]}")
    if c != 200:
        continue
    shape("article", d, {"lang": S, "title": S, "url": S, "stats": lambda v: isinstance(v, dict), "timeline": L,
                         "edits": L, "texts": L, "alerts": L, "pageviews_count": isint})
    shape("article.stats", d["stats"], {"edits_total": isint, "edits_human": isint, "distinct_users": isint,
                                        "first_edit": (iso, True), "last_edit": (iso, True), "delta_bytes": isint})
    for t in d["timeline"][:3]:
        shape("article.timeline", t, {"t": iso, "edits": isint})
    for t in d["edits"][:3]:
        shape("article.edit", t, edit_item)
    for t in d["texts"][:3]:
        shape("article.text", t, {"id": S, "rev_new": isint, "timestamp": iso, "comment": (S, True), "added_text": S, "removed_text": S})
    check("article edits<=100", len(d["edits"]) <= 100)
    check("article texts<=30", len(d["texts"]) <= 30)
    check("article url encoded", d["url"].startswith(f"https://{lang}.wikipedia.org/wiki/") and " " not in d["url"], d["url"])
    check("article title echoed", d["title"] == title, d["title"])
    check("article edits_total >= edits_human", d["stats"]["edits_total"] >= d["stats"]["edits_human"])
    ts = sum(t["edits"] for t in d["timeline"])
    print(f"  {lang}:{title}: total={d['stats']['edits_total']} timeline_sum={ts} edits_list={len(d['edits'])} texts={len(d['texts'])} url={d['url']}")
    # underscore variant normalizes
    c2, d2, _, _ = get(f"/api/articles/{lang}/{urllib.parse.quote(title.replace(' ', '_'), safe='')}")
    check("article underscore variant 200 same title", c2 == 200 and d2["title"] == title, f"{c2}")
for q in [("/api/articles/fr/Article_Qui_Nexiste_Pas_12345", 404), ("/api/articles/xx/Foo", 400),
          ("/api/articles/en/", 404), ("/api/articles/en", 404)]:
    c, dd, _, _ = get(q[0])
    check(f"{q[0]} -> {q[1]}", c == q[1] or (q[1] == 400 and c == 404), f"got {c} {str(dd)[:80]}")
    print("  ", q[0], "->", c, str(dd)[:80])

print("== articles with slash")
c, dd, _, _ = get("/api/edits/recent?include_bots=true&limit=200")
slash = [i for i in dd["items"] if "/" in i["title"]]
slash2 = None
if not slash:
    c, dd2, _, _ = get("/api/edits/top?minutes=1440&limit=100&include_bots=true")
    slash = [i for i in dd2["items"] if "/" in i["title"]]
if slash:
    s = slash[0]
    p = f"/api/articles/{s['lang']}/{urllib.parse.quote(s['title'], safe='')}"
    c, dd, _, _ = get(p)
    check(f"article slash {s['title']} 200", c == 200, f"{c} {str(dd)[:100]} {p}")
    p = f"/api/articles/{s['lang']}/{urllib.parse.quote(s['title'], safe='/')}"
    c, dd, _, _ = get(p)
    check(f"article slash (raw /) {s['title']} 200", c == 200, f"{c} {str(dd)[:100]} {p}")
    print("  slash title tested:", s["lang"], s["title"])
else:
    print("  (no recent title with '/' found)")

print("== pageviews")
c, d = timed("pageviews/top", "/api/pageviews/top")
check("pv top 200", c == 200)
shape("pv top", d, {"hour": iso, "items": L})
for it in d["items"][:3]:
    shape("pv top.item", it, {"lang": S, "title": S, "views": isint})
check("pv top limit 20", len(d["items"]) <= 20)
bad = [i["title"] for i in d["items"] if i["title"] in ("Main Page", "Wikipédia:Accueil principal", "الصفحة الرئيسية", "-") or i["title"].startswith(("Special:", "Spécial:", "خاص:"))]
check("pv top excludes main/special", not bad, bad)
v = [i["views"] for i in d["items"]]
check("pv top sorted", v == sorted(v, reverse=True))
print("  pv top default hour:", d["hour"], "top:", d["items"][:2])
c, dd, _, _ = get("/api/pageviews/top?hour=2023-09-08T22&lang=fr&limit=5")
check("pv top hour+lang+limit", c == 200 and len(dd["items"]) == 5 and all(i["lang"] == "fr" for i in dd["items"]), f"{c}")
for q, want in [("hour=garbage", 400), ("lang=xx", 400), ("limit=0", 400), ("limit=100000", None), ("hour=2020-01-01T00", None), ("hour=2023-09-08T12&lang=ar", 200)]:
    c, dd, _, _ = get("/api/pageviews/top?" + q)
    print("  pv top", q, "->", c, (str(dd)[:100] if c != 200 else f"items={len(dd['items'])} hour={dd['hour']}"))
    if want:
        check(f"pv top {q} -> {want}", c == want or (want == 400 and c == 422), f"got {c}")
c, dd, _, _ = get("/api/pageviews/en/Cookie_(informatique)")
print("  pv unknown ->", c, str(dd)[:100])
c, dd, _, _ = get("/api/pageviews/fr/" + urllib.parse.quote("Cookie (informatique)", safe=""))
shape("pv article", dd, {"lang": S, "title": S, "start": (iso, True), "end": (iso, True), "items": L})
print("  pv fr Cookie ->", c, dd if c != 200 else (len(dd["items"]), dd["items"][:2], dd["start"], dd["end"]))
if c == 200:
    for it in dd["items"][:3]:
        shape("pv.item", it, {"hour": iso, "views": isint})
    check("pv sorted", [i["hour"] for i in dd["items"]] == sorted(i["hour"] for i in dd["items"]))
c, dd, _, _ = get("/api/pageviews/en/" + urllib.parse.quote("Cookie (informatique)", safe="") + "?start=2023-09-08T13&end=2023-09-08T13")
print("  pv start=end ->", c, str(dd)[:200])
c, dd, _, _ = get("/api/pageviews/en/x?start=garbage")
print("  pv start=garbage ->", c, str(dd)[:100])
c, dd, _, _ = get("/api/pageviews/xx/x")
print("  pv lang=xx ->", c, str(dd)[:100])
c, dd, _, _ = get("/api/pageviews/fr/Titre_Inexistant_zzz")
print("  pv nonexistent title ->", c, str(dd)[:100])

print("== replay")
c, d = timed("replay", "/api/replay/alhaouz")
check("replay 200", c == 200)
shape("replay", d, {"event": lambda v: isinstance(v, dict), "start": iso, "end": iso, "hours_loaded": isint, "series": L})
shape("replay.event", d["event"], {"name": S, "time": iso})
check("replay 3 series", len(d["series"]) == 3)
for s in d["series"]:
    shape("replay.series", s, {"lang": S, "title": S, "title_at_time": S, "titles_counted": L, "url": S, "items": L,
                               "peak": (lambda v: isinstance(v, dict), True), "total": isint})
    for it in s["items"][:3]:
        shape("replay.item", it, {"hour": iso, "views": isint})
    check(f"replay {s['lang']} total==sum", s["total"] == sum(i["views"] for i in s["items"]))
    check(f"replay {s['lang']} items<=hours_loaded", len(s["items"]) <= d["hours_loaded"], f"{len(s['items'])} vs {d['hours_loaded']}")
    if s["peak"]:
        shape("replay.peak", s["peak"], {"hour": iso, "views": isint})
        mx = max(s["items"], key=lambda i: i["views"])
        check(f"replay {s['lang']} peak is max", s["peak"]["views"] == mx["views"])
    print("  ", s["lang"], "items", len(s["items"]), "total", s["total"], "peak", s["peak"])
print("  hours_loaded:", d["hours_loaded"], "vs stats", st["pageviews_hours_loaded"])

print("== search")
c, d = timed("search", "/api/search?q=football")
check("search 200", c == 200)
shape("search", d, {"q": S, "count": isint, "items": L})
for it in d["items"][:3]:
    shape("search.item", it, {"id": S, "lang": S, "title": S, "rev_new": isint, "timestamp": iso, "comment": (S, True), "snippet": S, "score": isnum})
    check("snippet <=240", len(it["snippet"]) <= 240 + 6, len(it["snippet"]))
sc = [i["score"] for i in d["items"]]
check("search sorted by score", sc == sorted(sc, reverse=True))
check("search count == len", d["count"] == len(d["items"]))
print("  search football:", d["count"], d["items"][0]["snippet"][:120] if d["items"] else None)
for q, want in [("q=a", 400), ("q=", 400), ("", 400), ("q=" + "x" * 101, 400), ("q=x&limit=51", 400), ("q=football&limit=50", 200),
                ("q=football&limit=0", 400), ("q=football&lang=xx", 400), ("q=football&lang=en", 200)]:
    c, dd, _, _ = get("/api/search?" + q)
    check(f"search {q[:30]} -> {want}", c == want or (want == 400 and c == 422), f"got {c} {str(dd)[:80]}")
for q in ['"', "$", "{", '"football"', "$where", "{$ne:1}", "foo bar", "-football", "\\", "%", "..", "<script>", "ab", "élection", "election", "زلزال", "football AND", "'", "\x00ab"]:
    c, dd, dt, _ = get("/api/search?q=" + urllib.parse.quote(q, safe=""))
    print(f"  search q={q!r} -> {c} {('count=' + str(dd['count'])) if c == 200 else str(dd)[:90]} {dt:.0f}ms")
    check(f"search special {q!r} not 5xx", c < 500, f"{c} {str(dd)[:100]}")
c1, a1, _, _ = get("/api/search?q=%C3%A9lection")
c2, a2, _, _ = get("/api/search?q=election")
check("search accent-insensitive", a1 and a2 and a1["count"] == a2["count"], f"{a1 and a1['count']} vs {a2 and a2['count']}")
c, a3, _, _ = get("/api/search?q=FOOTBALL")
check("search case-insensitive", a3["count"] == d["count"])

print("== explorer")
for col, kind in [("edits", "semi-structured"), ("edit_texts", "unstructured"), ("pageviews", "structured"),
                  ("alerts", "system"), ("ingestion_log", "system"), ("scores", "system")]:
    c, d = timed("explorer/" + col, f"/api/explorer/{col}?limit=5")
    check(f"explorer {col} 200", c == 200)
    shape("explorer." + col, d, {"collection": S, "data_kind": S, "count": isint, "size_bytes": isint, "avg_doc_bytes": isnum,
                                 "fields": L, "indexes": L, "skip": isint, "limit": isint, "docs": L})
    check(f"explorer {col} kind {kind}", d["data_kind"] == kind, d["data_kind"])
    check(f"explorer {col} <=5 docs", len(d["docs"]) <= 5)
    for ix in d["indexes"]:
        shape("explorer.index", ix, {"name": S, "key": lambda v: isinstance(v, dict)})
    keys = set()
    for doc in d["docs"]:
        keys |= set(doc)
        for k, v in doc.items():
            if k.endswith("_at") or k in ("timestamp", "hour", "window_start", "window_end", "created_at"):
                check(f"explorer {col}.{k} ISO", iso(v) or v is None, repr(v))
        check(f"explorer {col}._id is str", isinstance(doc.get("_id"), str), repr(doc.get("_id")))
    check(f"explorer {col} fields==union keys", set(d["fields"]) == keys, f"{sorted(set(d['fields']) ^ keys)}")
    # JSON-safety: no raw ObjectId / $date wrappers
    check(f"explorer {col} no $date/$oid", "$date" not in json.dumps(d) and "$oid" not in json.dumps(d))
c, dd, _, _ = get("/api/explorer/edits?limit=100000")
print("  explorer limit=100000 ->", c, (len(dd["docs"]), dd["limit"]) if c == 200 else str(dd)[:100])
c, dd, _, _ = get("/api/explorer/edits?limit=101")
print("  explorer limit=101 ->", c, (len(dd["docs"]), dd["limit"]) if c == 200 else str(dd)[:100])
c, dd, _, _ = get("/api/explorer/edits?limit=0")
print("  explorer limit=0 ->", c, (len(dd["docs"]), dd["limit"]) if c == 200 else str(dd)[:100])
c, dd, _, _ = get("/api/explorer/edits?skip=-1")
print("  explorer skip=-1 ->", c, str(dd)[:100])
t0 = time.time()
c, dd, dt, _ = get("/api/explorer/pageviews?limit=20&skip=100000000")
print("  explorer pageviews skip=1e8 ->", c, len(dd["docs"]) if c == 200 else dd, f"{dt:.0f}ms")
t0 = time.time()
c, dd, dt, _ = get("/api/explorer/pageviews?limit=20&skip=700000")
print("  explorer pageviews skip=700000 ->", c, len(dd["docs"]) if c == 200 else dd, f"{dt:.0f}ms")
c, dd, dt, _ = get("/api/explorer/edits?limit=20&skip=5000")
print("  explorer edits skip=5000 ->", c, len(dd["docs"]) if c == 200 else dd, f"{dt:.0f}ms")
for col in ["users", "system.users", "admin", "..", "EDITS", "edits%20", "%24cmd", "edits.chunks"]:
    c, dd, _, _ = get("/api/explorer/" + col)
    check(f"explorer/{col} -> 404", c == 404, f"got {c} {str(dd)[:80]}")
    if c != 404:
        print("  explorer", col, "->", c)
c, dd, _, _ = get("/api/explorer/edits?skip=abc")
print("  explorer skip=abc ->", c, str(dd)[:100])

print("== misc")
for p in ["/api/unknown", "/api", "/api/", "/api/edits", "/api/edits/", "/api/articles", "/docs", "/openapi.json", "/"]:
    c, dd, _, _ = get(p)
    print("  ", p, "->", c, str(dd)[:90])
# non-GET
for m in ["POST", "DELETE", "PUT"]:
    req = urllib.request.Request(BASE + "/api/stats", method=m, data=b"{}")
    try:
        r = urllib.request.urlopen(req)
        print("  ", m, "/api/stats ->", r.status)
    except urllib.error.HTTPError as e:
        print("  ", m, "/api/stats ->", e.code)

print("== latency (3 runs, ms)")
for name, p in [("stats", "/api/stats"), ("radar", "/api/radar"), ("explorer/edits", "/api/explorer/edits"),
                ("explorer/pageviews", "/api/explorer/pageviews"), ("pageviews/top", "/api/pageviews/top"),
                ("replay", "/api/replay/alhaouz"), ("alerts", "/api/alerts"), ("edits/top", "/api/edits/top"),
                ("edits/timeline", "/api/edits/timeline"), ("edits/timeline1440", "/api/edits/timeline?minutes=1440"),
                ("search", "/api/search?q=football"), ("recent", "/api/edits/recent")]:
    ds = [get(p)[2] for _ in range(3)]
    flag = "  <-- SLOW (>300ms)" if min(ds) > 300 else ""
    print(f"  {name:22s} {' '.join(f'{x:7.1f}' for x in ds)}{flag}")

print(f"\nRESULT: {OK} checks ok, {len(FAIL)} failed")
for f in FAIL:
    print(" -", f)
