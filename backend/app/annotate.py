"""Add `theme` + `theme_label` (null when the article is not enriched yet) to API items."""
from app.db import db
from app.themes import with_theme


async def annotate(items: list) -> list:
    """One primary-key query on `articles` (_id = "lang:title") for the whole list; mutates + returns it."""
    ids = list({f"{i['lang']}:{i['title']}" for i in items if i.get("lang") and i.get("title")})
    themes: dict = {}
    if ids:
        async for d in db.articles.find({"_id": {"$in": ids}}, {"theme": 1}):
            themes[d["_id"]] = d.get("theme")
    for i in items:
        with_theme(i, themes.get(f"{i.get('lang')}:{i.get('title')}"))
    return items
