"""Themes: the fixed list, the YAML mapping loader and the pure `classify` function.

Used by the enricher (and later the detector / backend). Nothing here touches the network or
MongoDB, so `classify` can be unit-tested (ingestion/tests/test_themes.py) and re-run on cached
data (`python -m radar_ingest.enricher --reclassify`). See docs/CONTRACT.md sections 4a and 6.

Order of evidence (first one that answers wins), always returning (theme, source, confidence, reason):
  a. human (P31 = Q5): died <= 30 days before ref_time -> personnalites (0.95);
     else first P106 found in the mapping (0.9; one P279 level up: 0.8); else personnalites (0.6)
  b. P31 in the mapping (0.95)
  c. P31 flagged "meta" (list, disambiguation...) -> autres / inconnu, on purpose
  d. P279 (one level up) of a P31 in the mapping (0.8)
  e. keywords on the Wikipedia categories (0.6)
  f. keywords on title + edit comments + added texts (0.4, needs >= 2 distinct hits)
  g. autres / inconnu (0.0)

CLI:  python -m radar_ingest.themes --verify   (checks every QID of the mapping against Wikidata)
"""
import os
import re
import sys
from collections import namedtuple
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

# (id, exact French label) in display order, docs/CONTRACT.md section 4a.
THEMES = [
    ("catastrophes", "Catastrophes & accidents"),
    ("conflits", "Conflits & sécurité"),
    ("politique", "Politique & élections"),
    ("sport", "Sport"),
    ("personnalites", "Personnalités & décès"),
    ("culture", "Culture & médias"),
    ("science", "Science & technologie"),
    ("economie", "Économie & entreprises"),
    ("sante", "Santé"),
    ("autres", "Autres"),
]
THEME_IDS = [t[0] for t in THEMES]
THEME_LABELS = dict(THEMES)

# theme_source values
SRC_WIKIDATA, SRC_CATEGORIES, SRC_KEYWORDS, SRC_UNKNOWN = "wikidata", "catégories", "mots-clés", "inconnu"

HUMAN_QID = "Q5"
DEATH_WINDOW = timedelta(days=30)
# When several themes match keywords equally, the most specific one wins ("personnalites" and "culture"
# are the broadest, so they come last).
KEYWORD_PRIORITY = ["catastrophes", "conflits", "sport", "politique", "sante", "science", "economie",
                    "culture", "personnalites"]
NO_EVIDENCE = "aucune classe Wikidata, catégorie ni mot-clé reconnu → autres"  # reason when nothing matched
MIN_TEXT_HITS = 2  # keyword fallback on free text needs at least this many (title hits count double)

Classification = namedtuple("Classification", "theme source confidence reason")

_ARABIC = re.compile(r"[؀-ۿ]")
_QID_META_LINE = re.compile(r"^\s+(Q\d+)\s*:\s*(.*?)\s*(?:#\s*(.*?))?\s*$")


def default_mapping_path() -> Path:
    env = os.environ.get("THEMES_MAPPING")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "themes_mapping.yaml"


def _keyword_regex(words: list[str]) -> re.Pattern | None:
    """One alternation per keyword list. Latin keywords: whole words (plural s/es/x allowed).
    Arabic keywords: optional prefix particles (ال, بال, لل, و...), any ending (suffixes are common)."""
    latin, arabic = [], []
    for w in sorted({w.strip() for w in words if w and w.strip()}, key=len, reverse=True):
        (arabic if _ARABIC.search(w) else latin).append(re.escape(w))
    parts = []
    if latin:
        parts.append(r"(?<!\w)(" + "|".join(latin) + r")(?:s|es|x)?(?!\w)")
    if arabic:
        parts.append(r"(?<!\w)(?:[وفبلك]?ال|[وفبلك])?(" + "|".join(arabic) + r")")
    if not parts:
        return None
    return re.compile("|".join(parts), re.IGNORECASE)


class Mapping:
    """In-memory form of themes_mapping.yaml."""

    def __init__(self, data: dict, comment_labels: dict[str, str] | None = None, path: str | None = None):
        self.path = path
        self.version = data.get("version")
        self.wikidata: dict[str, str] = {}
        self.occupations: dict[str, str] = {}
        self.meta: dict[str, str] = {}
        for section, target in (("wikidata", self.wikidata), ("occupations", self.occupations)):
            for qid, theme in (data.get(section) or {}).items():
                if theme not in THEME_LABELS or theme == "autres":
                    raise ValueError(f"themes_mapping.yaml: {section}.{qid} has unknown theme {theme!r}")
                target[str(qid)] = theme
        for qid, why in (data.get("meta") or {}).items():
            self.meta[str(qid)] = str(why)
        self.labels = comment_labels or {}
        self.keywords: dict[str, dict[str, dict[str, re.Pattern | None]]] = {}
        self.keyword_lists: dict[str, dict[str, dict[str, list[str]]]] = {}
        for theme, sections in (data.get("keywords") or {}).items():
            if theme not in THEME_LABELS or theme == "autres":
                raise ValueError(f"themes_mapping.yaml: keywords.{theme} is not a theme id")
            for section in ("categories", "texts"):
                for lang, words in ((sections or {}).get(section) or {}).items():
                    self.keyword_lists.setdefault(theme, {}).setdefault(section, {})[lang] = list(words)
                    self.keywords.setdefault(theme, {}).setdefault(section, {})[lang] = _keyword_regex(words)

    def label(self, qid: str, labels: dict | None = None) -> str:
        """Best human label for a QID: cache label, else the YAML comment, else the QID itself."""
        if labels and labels.get(qid):
            return labels[qid]
        return self.labels.get(qid, qid)

    def regex(self, theme: str, section: str, lang: str):
        return self.keywords.get(theme, {}).get(section, {}).get(lang)


def load_mapping(path: str | Path | None = None) -> Mapping:
    path = Path(path) if path else default_mapping_path()
    text = path.read_text(encoding="utf-8")
    data = yaml.safe_load(text) or {}
    comment_labels = {}
    for line in text.splitlines():
        m = _QID_META_LINE.match(line)
        if m and m.group(3):
            comment_labels[m.group(1)] = m.group(3).split(" / ")[0].strip()
    return Mapping(data, comment_labels, str(path))


# ------------------------------------------------------------------ classify
def _as_utc(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _keyword_hits(rx, text: str) -> list[str]:
    if rx is None or not text:
        return []
    out = []
    for m in rx.finditer(text):
        word = next((g for g in m.groups() if g), None)
        if word:
            out.append(word.lower())
    return out


def _classify_by_categories(mapping: Mapping, lang: str, categories) -> Classification | None:
    best = None  # (score, -priority_index, theme, example_category, example_word)
    for theme in KEYWORD_PRIORITY:
        rx = mapping.regex(theme, "categories", lang)
        if rx is None:
            continue
        score, example = 0, None
        for cat in categories:
            hits = _keyword_hits(rx, cat)
            if hits:
                score += 1
                example = example or (cat, hits[0])
        if score:
            cand = (score, -KEYWORD_PRIORITY.index(theme), theme, example)
            if best is None or cand[:2] > best[:2]:
                best = cand
    if best is None:
        return None
    score, _, theme, (cat, word) = best
    return Classification(theme, SRC_CATEGORIES, 0.6,
                          f"catégorie « {cat} » contient « {word} » ({score} catégorie(s)) → {theme}")


def _classify_by_texts(mapping: Mapping, lang: str, title: str, comments, texts) -> Classification | None:
    best = None
    blob_comments = "\n".join(c for c in comments if c)
    blob_texts = "\n".join(t[:4000] for t in texts if t)
    for theme in KEYWORD_PRIORITY:
        rx = mapping.regex(theme, "texts", lang)
        if rx is None:
            continue
        words = {}
        for w in _keyword_hits(rx, title):
            words[w] = words.get(w, 0) + 2
        for w in _keyword_hits(rx, blob_comments) + _keyword_hits(rx, blob_texts):
            words.setdefault(w, 1)
        score = sum(words.values())
        if score >= MIN_TEXT_HITS and len(words) >= 1:
            cand = (score, -KEYWORD_PRIORITY.index(theme), theme, sorted(words))
            if best is None or cand[:2] > best[:2]:
                best = cand
    if best is None:
        return None
    score, _, theme, words = best
    return Classification(theme, SRC_KEYWORDS, 0.4,
                          f"mots-clés dans titre/commentaires/textes : {', '.join(words[:6])} → {theme}")


def classify(mapping: Mapping, *, lang: str, title: str = "", p31=(), p106=(), p570=None, ref_time=None,
             parents: dict | None = None, labels: dict | None = None,
             categories=(), comments=(), texts=()) -> Classification:
    """Pure classification following docs/CONTRACT.md section 6 (see module docstring).

    p31 / p106: lists of QIDs in claim order. parents: {qid: [P279 QIDs]} for the P31 / P106 classes
    (only one level up is used). labels: {qid: label} to make the reason readable.
    Always returns (theme, source, confidence, reason).
    """
    p31, p106 = list(p31 or ()), list(p106 or ())
    parents = parents or {}
    def lab(q):  # "Q123 label" or just "Q123" when no label is known
        name = mapping.label(q, labels)
        return "" if name == q else " " + name

    if HUMAN_QID in p31:
        p570, ref_time = _as_utc(p570), _as_utc(ref_time)
        if p570 is not None and ref_time is not None and -timedelta(days=1) <= ref_time - p570 <= DEATH_WINDOW:
            return Classification("personnalites", SRC_WIKIDATA, 0.95,
                                  f"P31 Q5 humain, P570 décès le {p570.date().isoformat()} (≤ 30 jours) → personnalites")
        for occ in p106:
            if occ in mapping.occupations:
                theme = mapping.occupations[occ]
                return Classification(theme, SRC_WIKIDATA, 0.9, f"P106 {occ}{lab(occ)} → {theme}")
        for occ in p106:
            for parent in parents.get(occ, ()):
                if parent in mapping.occupations:
                    theme = mapping.occupations[parent]
                    return Classification(theme, SRC_WIKIDATA, 0.8,
                                          f"P106 {occ}{lab(occ)} → P279 {parent}{lab(parent)} → {theme}")
        return Classification("personnalites", SRC_WIKIDATA, 0.6, "P31 Q5 humain sans métier connu → personnalites")

    for q in p31:
        if q in mapping.wikidata:
            theme = mapping.wikidata[q]
            return Classification(theme, SRC_WIKIDATA, 0.95, f"P31 {q}{lab(q)} → {theme}")

    for q in p31:
        if q in mapping.meta:
            return Classification("autres", SRC_UNKNOWN, 0.0,
                                  f"P31 {q}{lab(q)} : {mapping.meta[q]} (pas de thème propre) → autres")

    for q in p31:
        for parent in parents.get(q, ()):
            if parent in mapping.wikidata:
                theme = mapping.wikidata[parent]
                return Classification(theme, SRC_WIKIDATA, 0.8,
                                      f"P31 {q}{lab(q)} → P279 {parent}{lab(parent)} → {theme}")

    res = _classify_by_categories(mapping, lang, categories or ())
    if res:
        return res
    res = _classify_by_texts(mapping, lang, title or "", comments or (), texts or ())
    if res:
        return res
    return Classification("autres", SRC_UNKNOWN, 0.0, NO_EVIDENCE)


# --------------------------------------------------------------- verification
def verify_mapping(path: str | Path | None = None) -> int:
    """Check every QID of the YAML against Wikidata: the comment label must match the English or
    French label. Returns the number of problems. Needs network + WIKI_USER_AGENT."""
    import time

    from . import common

    path = Path(path) if path else default_mapping_path()
    entries = {}  # qid -> comment label
    for line in path.read_text(encoding="utf-8").splitlines():
        m = _QID_META_LINE.match(line)
        if m and m.group(3):
            entries[m.group(1)] = m.group(3).split(" / ")[0].strip()
    session = common.make_session()
    qids = sorted(entries)
    found = {}
    for i in range(0, len(qids), 50):
        chunk = qids[i:i + 50]
        for attempt in range(6):
            try:
                r = session.get("https://www.wikidata.org/w/api.php", timeout=60, params={
                    "action": "wbgetentities", "ids": "|".join(chunk), "props": "labels",
                    "languages": "fr|en", "format": "json"})
                if r.status_code == 429:
                    time.sleep(common.parse_retry_after(r))
                    continue
                r.raise_for_status()
                found.update(r.json().get("entities", {}))
                break
            except Exception as exc:  # noqa: BLE001 - retry on any network error
                print(f"retry ({exc})", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
        time.sleep(0.4)
    problems = 0
    for qid in qids:
        ent = found.get(qid, {})
        names = [(ent.get("labels", {}).get(l, {}) or {}).get("value", "") for l in ("en", "fr")]
        want = entries[qid].lower()
        ok = any(want and (want in n.lower() or n.lower() in want) for n in names if n)
        if not ok:
            problems += 1
            print(f"MISMATCH {qid}: yaml says {entries[qid]!r}, wikidata says en={names[0]!r} fr={names[1]!r}")
    print(f"verified {len(qids)} QIDs against Wikidata: {len(qids) - problems} ok, {problems} problem(s)")
    return problems


if __name__ == "__main__":
    if "--verify" in sys.argv:
        sys.exit(1 if verify_mapping() else 0)
    m = load_mapping()
    print(f"{m.path}: {len(m.wikidata)} classes, {len(m.occupations)} occupations, {len(m.meta)} meta")
