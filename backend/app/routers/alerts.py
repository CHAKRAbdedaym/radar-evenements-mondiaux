from typing import Optional

from fastapi import APIRouter

from app.db import db
from app.util import alert_item, check_lang, clamp_limit

router = APIRouter(tags=["alerts"])


@router.get("/alerts")
async def alerts(limit: int = 50, lang: Optional[str] = None):
    lang = check_lang(lang)
    limit = clamp_limit(limit, 200)
    flt = {"lang": lang} if lang else {}
    docs = await db.alerts.find(flt).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": [alert_item(d) for d in docs]}
