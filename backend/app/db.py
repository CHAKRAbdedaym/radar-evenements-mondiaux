"""MongoDB access (motor) and runtime configuration read from the environment."""
import os

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URI = os.getenv("MONGO_URI", "mongodb://mongo:27017")
MONGO_DB = os.getenv("MONGO_DB", "radar")
WINDOW_MINUTES = int(os.getenv("WINDOW_MINUTES", "5"))
ALERT_COOLDOWN_MINUTES = int(os.getenv("ALERT_COOLDOWN_MINUTES", "15"))

# tz_aware=True: every datetime read from Mongo is UTC-aware.
client = AsyncIOMotorClient(MONGO_URI, tz_aware=True, serverSelectionTimeoutMS=5000)
db = client[MONGO_DB]


async def coll_stats(name: str) -> dict:
    """Fast metadata-based sizes ($collStats / WiredTiger metadata, no scan)."""
    try:
        res = await db[name].aggregate([{"$collStats": {"storageStats": {}}}]).to_list(1)
        s = res[0]["storageStats"] if res else {}
    except Exception:
        s = {}
    count = int(s.get("count", 0))
    size = int(s.get("size", 0))
    return {
        "count": count,
        "size_bytes": size,
        "avg_doc_bytes": int(s.get("avgObjSize", size // count if count else 0)),
        "storage_bytes": int(s.get("storageSize", 0)),
        "index_bytes": int(s.get("totalIndexSize", 0)),
    }

EVENT_ACTIVE_HOURS = int(os.getenv("EVENT_ACTIVE_HOURS", "2"))
