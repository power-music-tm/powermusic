"""Admin vs manager visibility of manager_requests rows.

Admin Delete and duplicate merges keep manager portal rows in the manager's
request history. Those rows use statuses the admin app never lists
("admin_deleted" / "merged"). Manager UI Pending vs Handled follows
``manager_visible_status`` — admin-deleted rows always show as Handled.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import case
from sqlalchemy.orm import Session

from app import models

STATUS_NEW = "new"
STATUS_HANDLED = "handled"
STATUS_ADMIN_DELETED = "admin_deleted"
STATUS_MERGED = "merged"

ADMIN_VISIBLE_STATUSES = (STATUS_NEW, STATUS_HANDLED)
ADMIN_HIDDEN_STATUSES = (STATUS_ADMIN_DELETED, STATUS_MERGED)


def is_admin_visible(req: models.ManagerRequest | None) -> bool:
    return req is not None and req.status in ADMIN_VISIBLE_STATUSES


def admin_visible_filter():
    return models.ManagerRequest.status.in_(ADMIN_VISIBLE_STATUSES)


def manager_visible_status(req: models.ManagerRequest) -> str:
    """Map admin-hidden rows to what the manager portal should show.

    Admin-deleted portal rows are always Handled (even legacy rows missing
    handled_at). Merged duplicates stay Pending until the survivor is handled.
    """
    if req.status == STATUS_ADMIN_DELETED:
        return STATUS_HANDLED
    if req.status == STATUS_MERGED:
        return STATUS_HANDLED if req.handled_at else STATUS_NEW
    return req.status


def manager_status_expr():
    """SQL twin of manager_visible_status for filters, counts and ordering."""
    return case(
        (
            models.ManagerRequest.status == STATUS_ADMIN_DELETED,
            STATUS_HANDLED,
        ),
        (
            models.ManagerRequest.status == STATUS_MERGED,
            case(
                (models.ManagerRequest.handled_at.isnot(None), STATUS_HANDLED),
                else_=STATUS_NEW,
            ),
        ),
        else_=models.ManagerRequest.status,
    )


def repair_admin_deleted_missing_handled_at(
    db: Session,
    rows: Iterable[models.ManagerRequest],
) -> int:
    """Stamp handled_at on legacy admin_deleted rows so unread / ordering work.

    Older deletes hid portal rows without setting handled_at, which left the
    manager portal counting them as Pending. Returns how many rows were repaired.
    """
    now = datetime.now(timezone.utc)
    fixed = 0
    manager_ids: set[str] = set()
    for row in rows:
        if row.status != STATUS_ADMIN_DELETED or row.handled_at is not None:
            continue
        row.handled_at = now
        fixed += 1
        if row.manager_id:
            manager_ids.add(str(row.manager_id))
    if fixed:
        db.flush()
        from app.manager_request_summary_cache import invalidate_manager_request_summary

        for manager_id in manager_ids:
            invalidate_manager_request_summary(manager_id)
    return fixed
