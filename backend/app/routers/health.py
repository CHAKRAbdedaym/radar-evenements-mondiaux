import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.db import client
from app.util import iso, utcnow

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    try:
        await asyncio.wait_for(client.admin.command("ping"), timeout=3)
        ok = True
    except Exception:
        ok = False
    body = {"status": "ok" if ok else "error", "mongo": ok, "time": iso(utcnow())}
    return JSONResponse(body, status_code=200 if ok else 503)
