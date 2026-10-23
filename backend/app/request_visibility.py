"""Admin vs manager visibility of manager_requests rows.

Admin Delete and duplicate merges keep manager portal rows so the manager's
request history is unchanged. Those rows get a status the admin app never
lists ("new" = New Requests, "handled" = Directory / archive).
"""

from __future__ import annotations

from sqlalchemy import case

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
    """Hidden rows keep their pre-delete look; merged rows follow their survivor via handled_at."""
    if req.status in ADMIN_HIDDEN_STATUSES:
        return STATUS_HANDLED if req.handled_at else STATUS_NEW
    return req.status


def manager_status_expr():
    """SQL twin of manager_visible_status for filters, counts and ordering."""
    return case(
        (
            models.ManagerRequest.status.in_(ADMIN_HIDDEN_STATUSES),
            case(
                (models.ManagerRequest.handled_at.isnot(None), STATUS_HANDLED),
                else_=STATUS_NEW,
            ),
        ),
        else_=models.ManagerRequest.status,
    )
