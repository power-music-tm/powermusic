"""Shared secret guard for HTTP cron triggers."""

from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import HTTPException, Request

from app.pilot2 import config


def require_cron_secret(request: Request, secret: Optional[str] = None) -> None:
    """Guard job-trigger endpoints. Open when PILOT2_CRON_SECRET is unset (local dev)."""
    expected = config.CRON_SECRET
    is_production = bool(os.getenv("VERCEL")) or os.getenv("ENVIRONMENT", "").lower() == "production"
    if is_production and not expected:
        raise HTTPException(
            status_code=503,
            detail="Cron endpoints require CRON_SECRET or PILOT2_CRON_SECRET in production",
        )
    if not expected:
        return
    header_secret = request.headers.get("x-cron-secret")
    bearer = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    query_secret = (secret or "").strip()
    if is_production:
        # cron-job.org scheduled runs occasionally omit saved custom headers;
        # ?secret= on the URL is a reliable fallback (same as local dev).
        provided = header_secret or bearer or query_secret
    else:
        provided = header_secret or bearer or query_secret
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing cron secret.")
