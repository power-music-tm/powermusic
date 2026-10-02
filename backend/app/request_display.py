"""Request id formatting — display numbers are encoded in id (req-001 → R-01)."""

from __future__ import annotations

import re
from typing import Iterable, List

from sqlalchemy import Integer, cast, func, text
from sqlalchemy.orm import Session

from app import models

_REQ_ID_RE = re.compile(r"^req-(\d+)$", re.IGNORECASE)


def parse_request_display_number(request_id: str | None) -> int:
    if not request_id:
        return 0
    match = _REQ_ID_RE.match(request_id.strip())
    if not match:
        return 0
    try:
        return int(match.group(1))
    except ValueError:
        return 0


def hydrate_request_display(requests: Iterable[models.ManagerRequest]) -> None:
    for request in requests:
        request.displayId = parse_request_display_number(request.id)


def allocate_request_ids(db: Session, count: int) -> List[str]:
    if count < 1:
        return []

    db.execute(text("SELECT pg_advisory_xact_lock(842001)"))

    rows = db.query(models.ManagerRequest.id).all()
    max_num = 0
    for (rid,) in rows:
        max_num = max(max_num, parse_request_display_number(rid))

    return [f"req-{max_num + 1 + i:03d}" for i in range(count)]


def request_id_numeric_desc():
    """Sort req-NNN ids newest-first (req-027 before req-001)."""
    return cast(func.nullif(func.substring(models.ManagerRequest.id, r"^req-(\d+)$"), ""), Integer).desc().nulls_last()
