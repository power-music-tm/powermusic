"""Derive partner-support activity feed from manager_requests (no activities table)."""

from __future__ import annotations

from typing import List

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.manager_request_tags import TAG_ALREADY_EXISTS, TAG_AUTO_MAIL
from app.user_display import hydrate_request_users, resolve_manager_name


def _person_label(req: models.ManagerRequest) -> str:
    return f"{req.person_first_name or ''} {req.person_last_name or ''}".strip()


def events_for_request(req: models.ManagerRequest) -> List[dict]:
    person = _person_label(req)
    manager_name = resolve_manager_name(req)
    events: List[dict] = []

    if req.received_at:
        if person:
            description = f"New request: {person}"
        elif manager_name:
            description = f"Request submitted by {manager_name}"
        else:
            description = "New request submitted"
        events.append(
            {
                "id": f"{req.id}:submitted",
                "timestamp": req.received_at,
                "type": "request_submitted",
                "description": description,
                "linkedRequestId": req.id,
            }
        )

    if req.tags and TAG_ALREADY_EXISTS in req.tags and req.received_at:
        events.append(
            {
                "id": f"{req.id}:duplicate",
                "timestamp": req.received_at,
                "type": "tag_applied",
                "description": "Exists in Directory tag applied",
                "linkedRequestId": req.id,
            }
        )

    if req.tags and TAG_AUTO_MAIL in req.tags and req.received_at:
        person = _person_label(req)
        events.append(
            {
                "id": f"{req.id}:automated",
                "timestamp": req.received_at,
                "type": "automated_email",
                "description": f"Auto mail received: {person}" if person else "Auto mail received",
                "linkedRequestId": req.id,
            }
        )

    if req.status == "handled" and req.handled_at:
        outcome = req.outcome or ("Added" if req.action == "Add" else "Removed")
        act_type = "marked_added" if outcome == "Added" else "marked_removed"
        if person:
            description = f"{outcome}: {person}"
        else:
            description = f"Request marked as {outcome}."
        events.append(
            {
                "id": f"{req.id}:handled",
                "timestamp": req.handled_at,
                "type": act_type,
                "description": description,
                "linkedRequestId": req.id,
            }
        )

    return events


def list_partner_activity(db: Session, *, limit: int = 10, partner_id: Optional[str] = None) -> List[dict]:
    scan_limit = max(limit * 4, 20)
    query = (
        db.query(models.ManagerRequest)
        .order_by(
            func.coalesce(
                models.ManagerRequest.handled_at,
                models.ManagerRequest.received_at,
            ).desc()
        )
    )
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
        
    rows = query.limit(scan_limit).all()
    hydrate_request_users(db, rows)

    events: List[dict] = []
    for req in rows:
        events.extend(events_for_request(req))

    events.sort(key=lambda item: item["timestamp"], reverse=True)
    return events[:limit]
