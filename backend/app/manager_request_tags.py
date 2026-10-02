"""Allowed manager_requests.tags values (flags only — not outcome)."""

from __future__ import annotations

from typing import Iterable, List

TAG_ALREADY_EXISTS = "already exists"
TAG_ALREADY_REMOVED = "already removed"
TAG_PARTNER_REQUEST = "partner req"
TAG_AUTO_MAIL = "auto mail"
TAG_VERIFIED = "verified"
TAG_UNVERIFIED = "unverified"
TAG_SENT_BY_ADMIN = "sent by admin"
TAG_CONFIRMED_DUPLICATE = "confirmed duplicate"
TAG_POTENTIAL_DUPLICATE = "potential duplicate"
TAG_REMOVED = "Removed"

# Backward-compatible aliases
TAG_AUTO_EMAIL = TAG_AUTO_MAIL
TAG_AUTOMATED_EMAIL = TAG_AUTO_MAIL
TAG_PARTNER_REQ = TAG_PARTNER_REQUEST

AUTOMATED_INTAKE_TAGS = [TAG_UNVERIFIED, TAG_AUTO_MAIL]
MANAGER_SUBMIT_TAGS = [TAG_VERIFIED, TAG_PARTNER_REQUEST]

ALLOWED_TAGS = frozenset(
    {
        TAG_ALREADY_EXISTS,
        TAG_ALREADY_REMOVED,
        TAG_PARTNER_REQUEST,
        TAG_AUTO_MAIL,
        TAG_VERIFIED,
        TAG_UNVERIFIED,
        TAG_SENT_BY_ADMIN,
        TAG_CONFIRMED_DUPLICATE,
        TAG_POTENTIAL_DUPLICATE,
    }
)

TAG_DISPLAY_ORDER = [
    TAG_VERIFIED,
    TAG_UNVERIFIED,
    TAG_PARTNER_REQUEST,
    TAG_SENT_BY_ADMIN,
    TAG_CONFIRMED_DUPLICATE,
    TAG_POTENTIAL_DUPLICATE,
    TAG_AUTO_MAIL,
    TAG_ALREADY_EXISTS,
    TAG_ALREADY_REMOVED,
    TAG_REMOVED,
]


def normalize_tags(tags: Iterable[str] | None) -> List[str]:
    cleaned = [t for t in (tags or []) if t in ALLOWED_TAGS]
    return sorted(set(cleaned), key=lambda tag: TAG_DISPLAY_ORDER.index(tag) if tag in TAG_DISPLAY_ORDER else 99)


def merge_tags(*tag_groups: Iterable[str] | None) -> List[str]:
    merged: List[str] = []
    for group in tag_groups:
        merged.extend(group or [])
    return normalize_tags(merged)


def has_tag(tags: Iterable[str] | None, tag: str) -> bool:
    return tag in set(tags or [])


def is_awaiting_manager_submission(tags: Iterable[str] | None) -> bool:
    """PureGym auto-mail received; no matching manager submission yet."""
    return (
        has_tag(tags, TAG_UNVERIFIED)
        and has_tag(tags, TAG_AUTO_MAIL)
        and not has_tag(tags, TAG_PARTNER_REQUEST)
    )


def is_visible_in_new_requests(tags: Iterable[str] | None) -> bool:
    """Verified manager submissions and pending auto-mail intake appear in New Requests."""
    return has_tag(tags, TAG_VERIFIED) or is_awaiting_manager_submission(tags)
