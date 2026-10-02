"""Rate limiting — Postgres-backed in production, in-memory fallback locally."""

from __future__ import annotations

import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

from fastapi import Depends, HTTPException, Request
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app import models
from app.api.auth import AuthenticatedUser, auth_is_required, get_authenticated_user
from app.api.dependencies import get_db


@dataclass
class _Bucket:
    hits: list[float] = field(default_factory=list)


_store: dict[str, _Bucket] = defaultdict(_Bucket)
_MAX_BUCKETS = 20_000


def _use_postgres_rate_limit() -> bool:
    if os.getenv("DISABLE_POSTGRES_RATE_LIMIT", "").lower() in ("1", "true", "yes"):
        return False
    if os.getenv("POSTGRES_RATE_LIMIT", "").lower() in ("1", "true", "yes"):
        return True
    return bool(os.getenv("VERCEL")) or os.getenv("ENVIRONMENT", "").lower() == "production"


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _rate_key(request: Request, user: AuthenticatedUser | None, scope: str) -> str:
    if user and user.id != "dev-bypass":
        return f"user:{user.id}:{scope}"
    return f"ip:{_client_ip(request)}:{scope}"


def _prune_store() -> None:
    if len(_store) <= _MAX_BUCKETS:
        return
    _store.clear()


def _enforce_memory_rate_limit(key: str, *, max_requests: int, window_seconds: int) -> None:
    now = time.time()
    bucket = _store[key]
    bucket.hits = [t for t in bucket.hits if now - t < window_seconds]
    if len(bucket.hits) >= max_requests:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please wait a moment and try again.",
        )
    bucket.hits.append(now)
    _prune_store()


def _enforce_postgres_rate_limit(
    db: Session,
    key: str,
    *,
    max_requests: int,
    window_seconds: int,
) -> None:
    now = time.time()
    window_start = int(now // window_seconds) * window_seconds
    stmt = (
        insert(models.ApiRateLimitBucket)
        .values(
            rate_key=key,
            window_start=window_start,
            hit_count=1,
            updated_at=datetime.now(timezone.utc),
        )
        .on_conflict_do_update(
            index_elements=["rate_key", "window_start"],
            set_={
                "hit_count": models.ApiRateLimitBucket.hit_count + 1,
                "updated_at": datetime.now(timezone.utc),
            },
        )
        .returning(models.ApiRateLimitBucket.hit_count)
    )
    hit_count = db.execute(stmt).scalar_one()
    db.commit()
    if hit_count > max_requests:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please wait a moment and try again.",
        )


def prune_old_rate_limit_buckets(db: Session, *, older_than_seconds: int = 7200) -> int:
    cutoff = int(time.time() // 60) * 60 - older_than_seconds
    deleted = (
        db.query(models.ApiRateLimitBucket)
        .filter(models.ApiRateLimitBucket.window_start < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(deleted or 0)


def rate_limit(
    scope: str,
    *,
    max_requests: int,
    window_seconds: int,
    user_dep: Callable = get_authenticated_user,
) -> Callable:
    """FastAPI dependency — enforces limit then returns the authenticated user."""

    def dependency(
        request: Request,
        user: AuthenticatedUser = Depends(user_dep),
        db: Session = Depends(get_db),
    ) -> AuthenticatedUser:
        if not auth_is_required() and os.getenv("DISABLE_RATE_LIMIT", "").lower() in ("1", "true", "yes"):
            return user

        key = _rate_key(request, user, scope)
        if _use_postgres_rate_limit():
            _enforce_postgres_rate_limit(
                db,
                key,
                max_requests=max_requests,
                window_seconds=window_seconds,
            )
        else:
            _enforce_memory_rate_limit(
                key,
                max_requests=max_requests,
                window_seconds=window_seconds,
            )
        return user

    return dependency
