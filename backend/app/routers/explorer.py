import asyncio

from fastapi import APIRouter

from app.db import coll_stats, db
from app.util import bad, clamp_limit, to_json

router = APIRouter(tags=["explorer"])

KINDS = {
    "edits": "semi-structured",
    "edit_texts": "unstructured",
    "pageviews": "structured",
    "alerts": "system",
    "ingestion_log": "system",
    "scores": "system",
}
SORTS = {
    "edits": [("timestamp", -1)],
    "edit_texts": [("timestamp", -1)],
    "pageviews": [("hour", -1)],
    "alerts": [("created_at", -1)],
    "ingestion_log": [("_id", -1)],
    "scores": [("computed_at", -1)],
}
MAX_SKIP = 100000


def _index_key(info: dict) -> dict:
    if "weights" in info:  # text index: show indexed fields instead of _fts/_ftsx
        return {f: "text" for f in info["weights"]}
    return {k: v for k, v in info["key"]}


@router.get("/explorer/{collection}")
async def explorer(collection: str, limit: int = 20, skip: int = 0):
    if collection not in KINDS:
        raise bad(f"unknown collection '{collection}' (allowed: {', '.join(KINDS)})", 404)
    limit = clamp_limit(limit, 100)
    if skip < 0 or skip > MAX_SKIP:
        raise bad(f"skip must be between 0 and {MAX_SKIP}")
    col = db[collection]
    stats, docs, idx = await asyncio.gather(
        coll_stats(collection),
        col.find().sort(SORTS[collection]).skip(skip).limit(limit).to_list(limit),
        col.index_information(),
    )
    fields: list = []
    for d in docs:
        for k in d:
            if k not in fields:
                fields.append(k)
    return {
        "collection": collection,
        "data_kind": KINDS[collection],
        "count": stats["count"],
        "size_bytes": stats["size_bytes"],
        "avg_doc_bytes": stats["avg_doc_bytes"],
        "fields": fields,
        "indexes": [{"name": n, "key": _index_key(i)} for n, i in idx.items()],
        "skip": skip,
        "limit": limit,
        "docs": [to_json(d) for d in docs],
    }
