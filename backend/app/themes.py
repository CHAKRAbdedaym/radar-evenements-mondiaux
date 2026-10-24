"""Fixed theme list (contract section 4a). Same ids / labels / order as ingestion/radar_ingest/themes.py."""
from typing import Optional

from app.util import bad

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


def label(theme: Optional[str]) -> Optional[str]:
    return THEME_LABELS.get(theme) if theme else None


def check_theme(theme: Optional[str]) -> Optional[str]:
    """None / empty -> None; unknown id -> HTTP 400."""
    if theme is None or theme == "":
        return None
    if theme not in THEME_LABELS:
        raise bad("theme must be one of: " + ", ".join(THEME_IDS))
    return theme


def with_theme(item: dict, theme: Optional[str]) -> dict:
    """Add theme + theme_label (both null when the article is not enriched yet)."""
    item["theme"] = theme if theme in THEME_LABELS else None
    item["theme_label"] = THEME_LABELS.get(theme) if theme else None
    return item
