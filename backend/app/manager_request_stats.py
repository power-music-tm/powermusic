"""Stored manager request counts on powermusic_users (fast summary reads)."""

from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app import models
from app.manager_request_tags import TAG_VERIFIED, has_tag


def _manager_uuid(manager_id: str | None) -> Optional[uuid.UUID]:
    if not manager_id or manager_id == "dev-bypass":
        return None
    try:
        return uuid.UUID(str(manager_id))
    except ValueError:
        return None


def _is_manager_portal_request(row: models.ManagerRequest) -> bool:
    return row.manager_id is not None and has_tag(row.tags or [], TAG_VERIFIED)


def get_stored_manager_request_stats(db: Session, manager_id: str) -> Optional[dict[str, int]]:
    manager_uuid = _manager_uuid(manager_id)
    if manager_uuid is None:
        return None

    user = (
        db.query(models.PowermusicUser)
        .filter(models.PowermusicUser.id == manager_uuid)
        .first()
    )
    if user is None:
        return None

    return {
        "total": int(user.manager_request_total or 0),
        "pendingCount": int(user.manager_request_pending or 0),
    }


def increment_manager_request_stats(db: Session, row: models.ManagerRequest) -> None:
    if not _is_manager_portal_request(row):
        return

    user = (
        db.query(models.PowermusicUser)
        .filter(models.PowermusicUser.id == row.manager_id)
        .with_for_update()
        .first()
    )
    if user is None:
        return

    user.manager_request_total = int(user.manager_request_total or 0) + 1
    if row.status == "new":
        user.manager_request_pending = int(user.manager_request_pending or 0) + 1


def decrement_manager_pending_stat(db: Session, row: models.ManagerRequest) -> None:
    if not _is_manager_portal_request(row):
        return

    user = (
        db.query(models.PowermusicUser)
        .filter(models.PowermusicUser.id == row.manager_id)
        .with_for_update()
        .first()
    )
    if user is None:
        return

    pending = int(user.manager_request_pending or 0)
    user.manager_request_pending = max(0, pending - 1)
