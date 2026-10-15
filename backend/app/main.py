"""Radar d'événements mondiaux - FastAPI backend (read-only API over MongoDB)."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routers import (alerts, articles, edits, explorer, health, pageviews,
                         radar, replay, search, stats)

app = FastAPI(
    title="Radar d'événements mondiaux - API",
    description="Wikipedia activity (ar, fr, en) stored in MongoDB: edits, texts, pageviews, alerts.",
    version="1.1",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    """Contract: bad parameter -> 400 {"detail": "message"}."""
    parts = []
    for err in exc.errors():
        loc = ".".join(str(x) for x in err.get("loc", []) if x != "query")
        parts.append(f"{loc}: {err.get('msg')}")
    return JSONResponse(status_code=400, content={"detail": "; ".join(parts) or "invalid parameter"})


for module in (health, stats, edits, radar, alerts, pageviews, replay, search, explorer, articles):
    app.include_router(module.router, prefix="/api")
