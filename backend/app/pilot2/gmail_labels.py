"""Derive dashboard + Gmail mirror fields from Gmail labelIds."""

from datetime import datetime, timezone
from typing import Iterable, List, Set

from app import models
from app.pilot2 import gmail


def derive_label_flags(
    label_ids: Iterable[str],
    *,
    account_email: str,
    from_email: str,
) -> dict:
    labels: Set[str] = set(label_ids or [])
    is_outbound = gmail.LABEL_SENT in labels or (
        from_email.lower() == account_email.lower()
    )
    in_inbox = gmail.LABEL_INBOX in labels
    in_trash = gmail.LABEL_TRASH in labels
    in_sent = gmail.LABEL_SENT in labels
    starred = gmail.LABEL_STARRED in labels
    archived = (
        not is_outbound
        and gmail.LABEL_INBOX not in labels
        and gmail.LABEL_TRASH not in labels
        and gmail.LABEL_SPAM not in labels
        and gmail.LABEL_DRAFT not in labels
    )
    return {
        "gmail_label_ids": sorted(labels),
        "gmail_in_inbox": in_inbox,
        "gmail_in_trash": in_trash,
        "gmail_in_sent": in_sent,
        "gmail_starred": starred,
        "gmail_archived": archived,
        "gmail_is_outbound": is_outbound,
    }


def apply_label_flags(
    email: models.Email,
    flags: dict,
    *,
    now: datetime | None = None,
) -> None:
    """Write derived Gmail flags and mirror read/archive/bin onto the row."""
    now = now or datetime.now(timezone.utc)
    for key, value in flags.items():
        setattr(email, key, value)

    labels = set(flags["gmail_label_ids"])
    email.read = gmail.LABEL_UNREAD not in labels
    if flags["gmail_in_trash"]:
        email.deleted = True
        if email.deleted_at is None:
            email.deleted_at = now
    elif email.deleted and not flags["gmail_in_trash"]:
        email.deleted = False
        email.deleted_at = None

    if not email.deleted:
        email.archived = flags["gmail_archived"]


def merge_label_delta(
    current: List[str],
    added: List[str] | None = None,
    removed: List[str] | None = None,
) -> List[str]:
    labels = set(current or [])
    labels.update(added or [])
    labels -= set(removed or [])
    return sorted(labels)
