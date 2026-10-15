import re
import unicodedata
from typing import Optional

from fastapi import APIRouter

from app.db import db
from app.util import bad, check_lang, clamp_limit, iso

router = APIRouter(tags=["search"])

SNIPPET = 240


def _fold_char(c: str) -> str:
    """Lower-case + strip accents, always returning exactly one char (keeps offsets aligned)."""
    base = next((x for x in unicodedata.normalize("NFD", c) if not unicodedata.combining(x)), c)
    low = base.lower()
    return low if len(low) == 1 else base


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
async def search(q: str = "", lang: Optional[str] = None, limit: int = 20):
    q = q.strip()
    if len(q) < 2 or len(q) > 100:
        raise bad("q must be between 2 and 100 characters")
    lang = check_lang(lang)
    limit = clamp_limit(limit, 50)
    flt: dict = {"$text": {"$search": q}}
    if lang:
        flt["lang"] = lang
    score = {"$meta": "textScore"}
    docs = await db.edit_texts.find(
        flt, {"lang": 1, "title": 1, "rev_new": 1, "timestamp": 1, "comment": 1, "added_text": 1, "score": score}
    ).sort([("score", score)]).limit(limit).to_list(limit)

    terms = [t for t in re.findall(r"\w+", q) if len(t) >= 2] or [q]
    items = []
    for d in docs:
        snippet = (make_snippet(d.get("added_text"), terms) or make_snippet(d.get("comment"), terms)
                   or (d.get("added_text") or d.get("comment") or "")[:SNIPPET])
        items.append({
            "id": d["_id"], "lang": d.get("lang"), "title": d.get("title"), "rev_new": d.get("rev_new"),
            "timestamp": iso(d.get("timestamp")), "comment": d.get("comment"),
            "snippet": snippet, "score": round(d.get("score", 0), 3),
        })
    return {"q": q, "count": len(items), "items": items}
