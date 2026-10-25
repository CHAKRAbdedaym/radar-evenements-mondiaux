import re
import unicodedata
from typing import Optional

from fastapi import APIRouter

from app.annotate import annotate
from app.db import db
from app.themes import check_theme
from app.util import bad, check_lang, clamp_limit, iso

router = APIRouter(tags=["search"])

SNIPPET = 240
TEXT_CANDIDATES = 1000  # the best 1000 text matches are re-ranked (and theme-filtered) after the query
SUMMARY_WEIGHT = 0.3    # rank factor of a comment-only match (a match in the added text counts 1)
MIN_TEXT = 25           # shorter cleaned added_text (e.g. "|football") is a markup fragment, not text
TEXT_CAP = 6000         # chars of added_text pulled per candidate

_REF = re.compile(r"<ref[^>/]*/>|<ref[^>]*>.*?(?:</ref>|$)", re.S | re.I)
_TAG = re.compile(r"</?[a-zA-Z][^>]*>")
_TEMPLATE = re.compile(r"\{\{[^{}]*\}\}")
_NS_LINK = re.compile(r"\[\[\s*(?:Category|Catégorie|تصنيف|File|Fichier|Image|ملف|صورة)\s*:[^\]]*\]\]", re.I)
_PIPED = re.compile(r"\[\[[^\[\]|]*\|([^\[\]]*)\]\]")
_LINK = re.compile(r"\[\[([^\[\]]*)\]\]")
_EXT = re.compile(r"\[(?:https?:)?//\S+\s*([^\]]*)\]")


def strip_wikitext(text: Optional[str]) -> str:
    """Plain text from wikitext: refs, templates, category/file links, [[a|b]] -> b, bold/italic marks."""
    if not text:
        return ""
    text = _REF.sub("", text)
    text = _NS_LINK.sub("", text)
    text = _LINK.sub(r"\1", _PIPED.sub(r"\1", text))
    for _ in range(8):  # nested templates: innermost first
        new = _TEMPLATE.sub("", text)
        if new == text:
            break
        text = new
    text = _EXT.sub(r"\1", text)
    text = _TAG.sub("", text)
    for mark in ("'''", "''", "{{", "}}", "[[", "]]"):
        text = text.replace(mark, "")
    return " ".join(text.split())


def _fold_char(c: str) -> str:
    """Lower-case + strip accents, always returning exactly one char (keeps offsets aligned)."""
    base = next((x for x in unicodedata.normalize("NFD", c) if not unicodedata.combining(x)), c)
    low = base.lower()
    return low if len(low) == 1 else base


_MARKS = re.compile("[\u0300-\u036f]")


def _fast_fold(text: str) -> str:
    """Cheap lower-case + accent strip for membership tests (offsets not preserved)."""
    return _MARKS.sub("", unicodedata.normalize("NFD", text.lower()))


def _fold(text: str) -> str:
    return "".join(_fold_char(c) for c in text)


def make_snippet(text: Optional[str], terms: list) -> Optional[str]:
    """<= 240 chars of text around the first match of any term (case/accent-insensitive,
    like the MongoDB text index)."""
    if not text:
        return None
    text = " ".join(text.split())
    folded_terms = [_fold(t) for t in terms if t]
    if not folded_terms:
        return None
    m = re.search("|".join(re.escape(t) for t in folded_terms), _fold(text))
    if m is None:
        return None
    start = max(0, m.start() - SNIPPET // 3)
    end = min(len(text), start + SNIPPET)
    start = max(0, end - SNIPPET)
    return ("…" if start > 0 else "") + text[start:end] + ("…" if end < len(text) else "")


@router.get("/search")
async def search(q: str = "", lang: Optional[str] = None, theme: Optional[str] = None,
                 group: int = 0, limit: int = 20):
    q = q.strip()
    if len(q) < 2 or len(q) > 100:
        raise bad("q must be between 2 and 100 characters")
    lang = check_lang(lang)
    theme = check_theme(theme)
    limit = clamp_limit(limit, 50)
    flt: dict = {"$text": {"$search": q}}
    if lang:
        flt["lang"] = lang
    # best TEXT_CANDIDATES by textScore, re-ranked below: text matches before summary-only matches
    pipeline: list = [
        {"$match": flt},
        {"$addFields": {"score": {"$meta": "textScore"}, "_aid": {"$concat": ["$lang", ":", "$title"]}}},
        {"$sort": {"score": -1}},
        {"$limit": TEXT_CANDIDATES},
    ]
    if theme:  # theme filter (articles.theme)
        pipeline += [
            {"$lookup": {"from": "articles", "localField": "_aid", "foreignField": "_id", "as": "a",
                         "pipeline": [{"$project": {"theme": 1}}]}},
            {"$match": {"a.theme": theme}},
        ]
    pipeline.append({"$project": {
        "lang": 1, "title": 1, "rev_new": 1, "timestamp": 1, "comment": 1, "score": 1,
        "added_text": {"$substrCP": [{"$ifNull": ["$added_text", ""]}, 0, TEXT_CAP]}}})
    docs = await db.edit_texts.aggregate(pipeline, allowDiskUse=True).to_list(TEXT_CANDIDATES)

    terms = [t for t in re.findall(r"\w+", q) if len(t) >= 2] or [q]
    folded = [_fast_fold(t) for t in terms]
    ranked = []
    for d in docs:
        text = strip_wikitext(d.get("added_text"))
        in_text = len(text) >= MIN_TEXT and any(t in _fast_fold(text) for t in folded)
        raw_score = d.get("score", 0)
        ranked.append((raw_score * (1.0 if in_text else SUMMARY_WEIGHT), d, text, in_text))
    ranked.sort(key=lambda r: -r[0])
    items = []
    for _, d, text, in_text in ranked:
        items.append({
            "id": d["_id"], "lang": d.get("lang"), "title": d.get("title"), "rev_new": d.get("rev_new"),
            "timestamp": iso(d.get("timestamp")), "comment": d.get("comment"),
            "snippet": None, "score": round(d.get("score", 0), 3),
            "match_in": "texte" if in_text else "résumé",
            "_text": text, "_in_text": in_text,
        })
    if group:
        # identical comment-only results (same summary) -> one item listing the articles concerned
        out: list = []
        by_comment: dict = {}
        for it in items:
            if it["match_in"] == "résumé" and it["comment"]:
                g = by_comment.get(it["comment"])
                if g is not None:
                    if it["title"] not in g["titles"]:
                        g["articles_count"] += 1
                        if len(g["titles"]) < 5:
                            g["titles"].append(it["title"])
                    continue
                by_comment[it["comment"]] = it
            it["articles_count"], it["titles"] = 1, [it["title"]]
            out.append(it)
        items = out
    items = items[:limit]
    for it in items:  # snippets only for the returned items (accent-aware offsets are slow)
        text, comment = it.pop("_text"), strip_wikitext(it["comment"])
        in_text = it.pop("_in_text")
        it["snippet"] = ((make_snippet(text, terms) if in_text else None) or make_snippet(comment, terms)
                         or text[:SNIPPET] or comment[:SNIPPET])
    await annotate(items)
    return {"q": q, "count": len(items), "items": items}
