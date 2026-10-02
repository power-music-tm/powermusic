"""Short-lived cache for manager request summary counts."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from threading import Lock
from typing import Optional

SUMMARY_CACHE_TTL_SECONDS = int(os.getenv("MANAGER_SUMMARY_CACHE_TTL", "30"))
_MAX_ENTRIES = 5000

_cache: dict[str, tuple[float, dict[str, int]]] = {}
_lock = Lock()


@dataclass(frozen=True)
class ManagerRequestSummary:
    total: int
    pending_count: int

    def as_dict(self) -> dict[str, int]:
        return {"total": self.total, "pendingCount": self.pending_count}


def get_manager_request_summary(manager_id: str) -> Optional[dict[str, int]]:
    if not manager_id:
        return None
    now = time.time()
    with _lock:
        entry = _cache.get(manager_id)
        if entry is None:
            return None
        cached_at, payload = entry
        if now - cached_at > SUMMARY_CACHE_TTL_SECONDS:
            _cache.pop(manager_id, None)
            return None
        return dict(payload)


def set_manager_request_summary(
    manager_id: str,
    *,
    total: int,
    pending_count: int,
) -> None:
    if not manager_id:
        return
    with _lock:
        if len(_cache) >= _MAX_ENTRIES:
            _cache.clear()
        _cache[manager_id] = (
            time.time(),
            {"total": int(total), "pendingCount": int(pending_count)},
        )


def invalidate_manager_request_summary(manager_id: str | None) -> None:
    if not manager_id:
        return
    with _lock:
        _cache.pop(manager_id, None)
