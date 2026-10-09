"""Persistent registry management for processed Gmail message IDs."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional, Set

from sqlalchemy.orm import Session
from app import models


def record_processed_gmail_message(
    db: Session,
    gmail_message_id: str,
    account_email: Optional[str] = None,
) -> bool:
    """Record a Gmail message ID as processed in the database.
    
    Returns True if recorded, False if already present or invalid.
    """
    if not gmail_message_id:
        return False
    msg_id = gmail_message_id.strip()
    if not msg_id:
        return False

    existing = (
        db.query(models.ProcessedGmailMessage)
        .filter(models.ProcessedGmailMessage.gmail_message_id == msg_id)
        .first()
    )
    if existing:
        return False

    row = models.ProcessedGmailMessage(
        gmail_message_id=msg_id,
        processed_at=datetime.now(timezone.utc),
        account_email=account_email.strip().lower() if account_email else None,
    )
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
        return True
    except Exception:
        return False


def is_gmail_message_processed(db: Session, gmail_message_id: str) -> bool:
    """Check if a Gmail message ID has already been processed or consumed."""
    if not gmail_message_id:
        return False
    msg_id = gmail_message_id.strip()
    if not msg_id:
        return False

    processed = (
        db.query(models.ProcessedGmailMessage)
        .filter(models.ProcessedGmailMessage.gmail_message_id == msg_id)
        .first()
    )
    if processed:
        return True

    # Fallback: check manager_requests for active/handled rows carrying this source_gmail_message_id
    mr = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.source_gmail_message_id == msg_id)
        .first()
    )
    return mr is not None


def get_processed_gmail_message_ids(db: Session, message_ids: List[str]) -> Set[str]:
    """Return the subset of message_ids that have already been recorded as processed."""
    valid_ids = [m.strip() for m in message_ids if m and m.strip()]
    if not valid_ids:
        return set()

    recorded = {
        row.gmail_message_id
        for row in (
            db.query(models.ProcessedGmailMessage.gmail_message_id)
            .filter(models.ProcessedGmailMessage.gmail_message_id.in_(valid_ids))
            .all()
        )
        if row.gmail_message_id
    }

    mr_ids = {
        row.source_gmail_message_id
        for row in (
            db.query(models.ManagerRequest.source_gmail_message_id)
            .filter(models.ManagerRequest.source_gmail_message_id.in_(valid_ids))
            .all()
        )
        if row.source_gmail_message_id
    }

    return recorded.union(mr_ids)


def record_processed_gmail_messages_from_requests(
    db: Session, request_ids: List[str]
) -> int:
    """Record all non-null source_gmail_message_ids for the given request_ids before deletion."""
    if not request_ids:
        return 0

    rows = (
        db.query(models.ManagerRequest.source_gmail_message_id)
        .filter(models.ManagerRequest.id.in_(request_ids))
        .all()
    )

    count = 0
    for row in rows:
        if row.source_gmail_message_id and record_processed_gmail_message(db, row.source_gmail_message_id):
            count += 1
    return count
