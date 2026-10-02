"""Server-backed unread state for manager request history."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app import models


def _manager_uuid(manager_id: str) -> Optional[uuid.UUID]:
    if not manager_id or manager_id == "dev-bypass":
        return None
    try:
        return uuid.UUID(str(manager_id))
    except ValueError:
        return None


def is_request_unread(req: models.ManagerRequest, seen_at: Optional[datetime]) -> bool:
    if req.status != "handled" or not req.handled_at:
        return False
    if seen_at is None:
        return True
    return seen_at < req.handled_at


def load_seen_map(
    db: Session,
    *,
    manager_id: str,
    request_ids: List[str],
) -> Dict[str, datetime]:
    manager_uuid = _manager_uuid(manager_id)
    if manager_uuid is None or not request_ids:
        return {}

    rows = (
        db.query(models.ManagerRequestView)
        .filter(
            models.ManagerRequestView.manager_id == manager_uuid,
            models.ManagerRequestView.request_id.in_(request_ids),
        )
        .all()
    )
    return {row.request_id: row.seen_at for row in rows}


def count_unread_handled(
    db: Session,
    *,
    manager_id: str,
    base_query,
) -> int:
    manager_uuid = _manager_uuid(manager_id)
    if manager_uuid is None:
        return 0

    return (
        base_query.filter(
            models.ManagerRequest.status == "handled",
            models.ManagerRequest.handled_at.isnot(None),
        )
        .outerjoin(
            models.ManagerRequestView,
            and_(
                models.ManagerRequestView.request_id == models.ManagerRequest.id,
                models.ManagerRequestView.manager_id == manager_uuid,
            ),
        )
        .filter(
            or_(
                models.ManagerRequestView.seen_at.is_(None),
                models.ManagerRequestView.seen_at < models.ManagerRequest.handled_at,
            )
        )
        .count()
    )


def mark_request_seen(
    db: Session,
    *,
    manager_id: str,
    request_id: str,
) -> None:
    manager_uuid = _manager_uuid(manager_id)
    if manager_uuid is None:
        return

    now = datetime.now(timezone.utc)
    row = (
        db.query(models.ManagerRequestView)
        .filter(
            models.ManagerRequestView.manager_id == manager_uuid,
            models.ManagerRequestView.request_id == request_id,
        )
        .first()
    )
    if row:
        row.seen_at = now
    else:
        db.add(
            models.ManagerRequestView(
                manager_id=manager_uuid,
                request_id=request_id,
                seen_at=now,
            )
        )


def mark_all_handled_seen(
    db: Session,
    *,
    manager_id: str,
    base_query,
) -> int:
    manager_uuid = _manager_uuid(manager_id)
    if manager_uuid is None:
        return 0

    unread_rows = (
        base_query.filter(
            models.ManagerRequest.status == "handled",
            models.ManagerRequest.handled_at.isnot(None),
        )
        .outerjoin(
            models.ManagerRequestView,
            and_(
                models.ManagerRequestView.request_id == models.ManagerRequest.id,
                models.ManagerRequestView.manager_id == manager_uuid,
            ),
        )
        .filter(
            or_(
                models.ManagerRequestView.seen_at.is_(None),
                models.ManagerRequestView.seen_at < models.ManagerRequest.handled_at,
            )
        )
        .all()
    )

    now = datetime.now(timezone.utc)
    for req in unread_rows:
        existing = (
            db.query(models.ManagerRequestView)
            .filter(
                models.ManagerRequestView.manager_id == manager_uuid,
                models.ManagerRequestView.request_id == req.id,
            )
            .first()
        )
        if existing:
            existing.seen_at = now
        else:
            db.add(
                models.ManagerRequestView(
                    manager_id=manager_uuid,
                    request_id=req.id,
                    seen_at=now,
                )
            )
    return len(unread_rows)
