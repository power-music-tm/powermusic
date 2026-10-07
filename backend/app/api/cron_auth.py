"""Shared secret guard for HTTP cron triggers."""

from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import HTTPException, Request


def require_cron_secret(request: Request, secret: Optional[str] = None) -> None:
    """Guard job-trigger endpoints. Open when no secret is configured (local dev).

    Accepts the provided token if it matches **any** of the configured secrets
    (PILOT2_CRON_SECRET and/or CRON_SECRET), so Vercel's automatic
    ``Authorization: Bearer <CRON_SECRET>`` header is accepted even when
    PILOT2_CRON_SECRET is also set to a different value.

    Reads env vars at request time so tests can monkeypatch os.environ freely.
    """
    # Collect every non-empty configured secret (deduplicated, order preserved).
    _seen: set[str] = set()
    valid_secrets: list[str] = []
    for val in (
        os.getenv("PILOT2_CRON_SECRET", ""),
        os.getenv("CRON_SECRET", ""),
    ):
        if val and val not in _seen:
            _seen.add(val)
            valid_secrets.append(val)

    is_production = bool(os.getenv("VERCEL")) or os.getenv("ENVIRONMENT", "").lower() == "production"
    if is_production and not valid_secrets:
        raise HTTPException(
            status_code=503,
            detail="Cron endpoints require CRON_SECRET or PILOT2_CRON_SECRET in production",
        )
    if not valid_secrets:
        # Local dev with no secret configured — allow through.
        return

    header_secret = request.headers.get("x-cron-secret")
    bearer = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    query_secret = (secret or "").strip()
    provided = header_secret or bearer or query_secret

    # Accept if the provided value matches ANY configured secret (constant-time).
    for expected in valid_secrets:
        if provided and hmac.compare_digest(provided, expected):
            return

    raise HTTPException(status_code=401, detail="Invalid or missing cron secret.")
