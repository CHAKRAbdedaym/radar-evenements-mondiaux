"""Stale-while-revalidate in-memory cache with a background refresher.

Used for the heavy theme aggregations: a value is computed once (warm-up at startup),
served from memory, and recomputed in the background once it is older than its TTL,
so requests never wait for a recompute after warm-up. Keys that nobody asked for
during IDLE_EVICT seconds stop being refreshed.
"""
import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

log = logging.getLogger("radar.cache")

IDLE_EVICT = 600.0


class _Entry:
    __slots__ = ("value", "computed", "accessed", "ttl", "factory", "refreshing")

    def __init__(self, value: Any, ttl: float, factory: Callable[[], Awaitable[Any]]) -> None:
        self.value = value
        self.computed = time.monotonic()
        self.accessed = self.computed
        self.ttl = ttl
        self.factory = factory
        self.refreshing = False


class SWRCache:
    def __init__(self) -> None:
        self._entries: dict = {}
        self._locks: dict = {}
        self._task: asyncio.Task | None = None

    async def _refresh(self, key: str) -> None:
        e = self._entries.get(key)
        if e is None or e.refreshing:
            return
        e.refreshing = True
        try:
            e.value = await e.factory()
            e.computed = time.monotonic()
        except Exception as exc:  # keep serving the stale value
            log.warning("refresh of %s failed: %s", key, exc)
        finally:
            e.refreshing = False

    async def get(self, key: str, ttl: float, factory: Callable[[], Awaitable[Any]]) -> Any:
        e = self._entries.get(key)
        now = time.monotonic()
        if e is not None:
            e.accessed = now
            e.factory = factory
            if now - e.computed > ttl and not e.refreshing:
                asyncio.create_task(self._refresh(key))
            return e.value
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            e = self._entries.get(key)
            if e is not None:
                return e.value
            value = await factory()  # cold: the first caller pays
            self._entries[key] = _Entry(value, ttl, factory)
            return value

    async def _loop(self, interval: float) -> None:
        while True:
            await asyncio.sleep(interval)
            now = time.monotonic()
            for key, e in list(self._entries.items()):
                if now - e.accessed > IDLE_EVICT:
                    self._entries.pop(key, None)
                elif now - e.computed >= e.ttl * 0.75:
                    await self._refresh(key)

    def start(self, interval: float = 15.0) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(interval))

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None


swr = SWRCache()
