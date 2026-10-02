"""Automated partner roster emails → manager_requests (not the email queue).

Hard gate: sender must match automated_roster_sources (email or domain).
Subject/body understanding is fully deterministic (regex). No AI is involved.

Supported subject patterns (case-insensitive):
  Add / Joinee:   "PureGym Joinee", "PureGym New Member", "New PureGym user"
  Remove / Leaver: "PureGym Leaver", "Remove user"

Body format (labelled lines):
  Name: <First Last>
  Email: <email>
  Club: <club name>
  Leave date: <YYYY-MM-DD>   (Leaver emails only)
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Literal, Optional, Sequence

from sqlalchemy.orm import Session

from app import models, schemas
from app.manager_request_intake import intake_automated_email_request
from app.partner_allowlists import list_automated_sources, sender_matches_automated_sources

logger = logging.getLogger(__name__)

# Legacy PureGym constants kept for tests / docs
PUREGYM_LEAVER_SENDER = "em@myptzone.co"
ADD_SUBJECT = "new puregym user"
REMOVE_SUBJECT = "puregym leaver"

_NAME_RE = re.compile(r"^Name:\s*(.+?)\s*$", re.MULTILINE | re.IGNORECASE)
_EMAIL_RE = re.compile(r"^Email:\s*(\S+)", re.MULTILINE | re.IGNORECASE)
_CLUB_RE = re.compile(r"^Club:\s*(.+?)\s*$", re.MULTILINE | re.IGNORECASE)
_LEAVE_DATE_RE = re.compile(r"^Leave date:\s*(.+?)\s*$", re.MULTILINE | re.IGNORECASE)


def _normalize_body(body: str) -> str:
    return (body or "").replace("\r\n", "\n").replace("\r", "\n")


def _norm_subject(subject: str) -> str:
    return re.sub(r"\s+", " ", (subject or "").strip().lower())


def _split_full_name(full_name: str) -> tuple[str, str]:
    text = (full_name or "").strip()
    if not text:
        return "", ""
    parts = text.split(None, 1)
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


def _clean_field(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    return text.splitlines()[0].strip().strip(".,;:")


def _resolve_sources(
    *,
    db: Optional[Session] = None,
    sources: Optional[Sequence[models.AutomatedRosterSource]] = None,
) -> Sequence[models.AutomatedRosterSource]:
    if sources is not None:
        return sources
    if db is not None:
        return list_automated_sources(db)
    return ()


def sender_is_allowlisted(
    from_email: str,
    *,
    db: Optional[Session] = None,
    sources: Optional[Sequence[models.AutomatedRosterSource]] = None,
) -> bool:
    resolved = _resolve_sources(db=db, sources=sources)
    if not resolved:
        return False
    return sender_matches_automated_sources(from_email, resolved)


def _classify_subject(subject: str) -> Optional[Literal["Add", "Remove"]]:
    """Deterministic subject-line classification — the sole intent detector.

    Recognised patterns (case-insensitive, internal whitespace normalised):
      Remove: subject contains "leaver"
      Remove: subject contains both "remove" and "user"
      Add:    subject contains "joinee"
      Add:    subject contains "new member"
      Add:    subject contains both "new" and "user"
    """
    subj = _norm_subject(subject)
    # Remove / Leaver signals
    if "leaver" in subj:
        return "Remove"
    if "remove" in subj and "user" in subj:
        return "Remove"
    # Add / Joinee signals
    if "joinee" in subj:
        return "Add"
    if "new member" in subj:
        return "Add"
    if "new" in subj and "user" in subj:
        return "Add"
    return None


def parse_labelled_roster_body(
    body: str,
    *,
    action: Literal["Add", "Remove"],
) -> Optional[schemas.PersonInfo]:
    del action
    text = _normalize_body(body)
    name_match = _NAME_RE.search(text)
    email_match = _EMAIL_RE.search(text)
    club_match = _CLUB_RE.search(text)
    if not name_match or not email_match:
        return None

    first, last = _split_full_name(_clean_field(name_match.group(1)))
    person_email = _clean_field(email_match.group(1))
    club = _clean_field(club_match.group(1)) if club_match else ""

    if not person_email:
        return None

    try:
        return schemas.PersonInfo(
            firstName=first or None,
            lastName=last or None,
            email=person_email,
            location=club or None,
        )
    except Exception:
        logger.warning("Labelled roster body failed PersonInfo validation", exc_info=True)
        return None


def _parse_deterministic(
    subject: str,
    body: str,
) -> Optional[tuple[schemas.PersonInfo, Literal["Add", "Remove"], str]]:
    """Classify action from subject and extract fields from body with regex.

    Returns (person, action, leave_date) or None if not a roster email.
    """
    action = _classify_subject(subject)
    if action is None:
        return None
    person = parse_labelled_roster_body(body, action=action)
    if person is None:
        return None
    leave = _LEAVE_DATE_RE.search(_normalize_body(body))
    leave_date = _clean_field(leave.group(1)) if leave else ""
    return person, action, leave_date


def classify_roster_email(
    from_email: str,
    subject: str,
    body: str,
    *,
    from_name: str = "",
    db: Optional[Session] = None,
    sources: Optional[Sequence[models.AutomatedRosterSource]] = None,
) -> Optional[Literal["Add", "Remove"]]:
    """Allowlisted sender + deterministic parse → Add/Remove, else None."""
    del from_name
    if not sender_is_allowlisted(from_email, db=db, sources=sources):
        return None
    parsed = parse_roster_email(
        subject,
        body,
        sender_email=from_email,
        db=db,
        sources=sources,
    )
    return None if parsed is None else parsed[1]


def classify_puregym_roster_email(
    from_email: str,
    subject: str,
    body: str,
    *,
    from_name: str = "",
    db: Optional[Session] = None,
    sources: Optional[Sequence[models.AutomatedRosterSource]] = None,
) -> Optional[Literal["Add", "Remove"]]:
    return classify_roster_email(
        from_email,
        subject,
        body,
        from_name=from_name,
        db=db,
        sources=sources,
    )


def is_roster_notification(
    from_email: str,
    subject: str,
    body: str,
    *,
    from_name: str = "",
    db: Optional[Session] = None,
    sources: Optional[Sequence[models.AutomatedRosterSource]] = None,
) -> bool:
    return classify_roster_email(
        from_email,
        subject,
        body,
        from_name=from_name,
        db=db,
        sources=sources,
    ) is not None


def is_puregym_roster_notification(
    from_email: str,
    subject: str,
    body: str,
    *,
    from_name: str = "",
    db: Optional[Session] = None,
    sources: Optional[Sequence[models.AutomatedRosterSource]] = None,
) -> bool:
    return is_roster_notification(
        from_email,
        subject,
        body,
        from_name=from_name,
        db=db,
        sources=sources,
    )


def looks_like_puregym_roster_email(
    from_email: str,
    subject: str,
    body: str,
    *,
    is_automated: bool = False,
    from_name: str = "",
    db: Optional[Session] = None,
    sources: Optional[Sequence[models.AutomatedRosterSource]] = None,
) -> bool:
    del is_automated
    return is_roster_notification(
        from_email,
        subject,
        body,
        from_name=from_name,
        db=db,
        sources=sources,
    )


def parse_roster_email(
    subject: str,
    body: str,
    *,
    sender_email: str,
    from_name: str = "",
    db: Optional[Session] = None,
    sources: Optional[Sequence[models.AutomatedRosterSource]] = None,
) -> Optional[tuple[schemas.PersonInfo, Literal["Add", "Remove"]]]:
    del from_name
    if not sender_is_allowlisted(sender_email, db=db, sources=sources):
        return None

    extracted = _parse_deterministic(subject, body)
    if extracted is None:
        return None
    person, action, _leave = extracted
    return person, action


def parse_puregym_roster_email(
    subject: str,
    body: str,
    *,
    sender_email: str,
    from_name: str = "",
    db: Optional[Session] = None,
    sources: Optional[Sequence[models.AutomatedRosterSource]] = None,
) -> Optional[tuple[schemas.PersonInfo, Literal["Add", "Remove"]]]:
    return parse_roster_email(
        subject,
        body,
        sender_email=sender_email,
        from_name=from_name,
        db=db,
        sources=sources,
    )


def _manager_notes(subject: str, body: str, action: str, leave_date: str = "") -> str:
    parts = [f"Automated roster email. {action}", f"Subject: {(subject or '').strip()}"]
    leave = leave_date or ""
    if not leave:
        match = _LEAVE_DATE_RE.search(_normalize_body(body))
        if match:
            leave = _clean_field(match.group(1))
    if leave:
        parts.append(f"Leave date: {leave}")
    return "\n".join(parts)


def intake_roster_message(
    db: Session,
    *,
    from_email: str,
    from_name: str,
    subject: str,
    body: str,
    received_at: Optional[datetime] = None,
    gmail_message_id: Optional[str] = None,
    inbox_email: Optional[str] = None,
) -> bool:
    """Create a manager_request and return True if this message was consumed as roster mail."""
    sources = list_automated_sources(db)
    if not sender_is_allowlisted(from_email, sources=sources):
        return False

    extracted = _parse_deterministic(subject, body)
    if extracted is None:
        # Allowlisted but not a recognised roster request (subject/body did not match).
        return False

    person, action, leave_date = extracted
    intake_automated_email_request(
        db,
        person=person,
        action=action,
        manager_notes=_manager_notes(subject, body, action, leave_date=leave_date),
        received_at=received_at,
        source_gmail_message_id=gmail_message_id,
        from_email=from_email,
        subject=subject,
        inbox_email=inbox_email,
    )
    return True


def intake_puregym_roster_message(
    db: Session,
    *,
    from_email: str,
    from_name: str,
    subject: str,
    body: str,
    received_at: Optional[datetime] = None,
    gmail_message_id: Optional[str] = None,
    inbox_email: Optional[str] = None,
) -> bool:
    return intake_roster_message(
        db,
        from_email=from_email,
        from_name=from_name,
        subject=subject,
        body=body,
        received_at=received_at,
        gmail_message_id=gmail_message_id,
        inbox_email=inbox_email,
    )


def try_intake_automated_person_request(
    db: Session,
    email: models.Email,
    *,
    is_automated: bool = False,
) -> Optional[models.ManagerRequest]:
    """Legacy path when an emails row already exists (ingest API / re-processing)."""
    del is_automated
    if not intake_roster_message(
        db,
        from_email=email.from_email,
        from_name=email.from_name,
        subject=email.subject,
        body=email.body,
        received_at=email.received_at,
        gmail_message_id=email.gmail_message_id,
        inbox_email=email.account_email,
    ):
        return None

    if email.gmail_message_id:
        return (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.source_gmail_message_id == email.gmail_message_id)
            .first()
        )
    return (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.source_email_id == email.id)
        .first()
    )


def make_source(*, kind: str, pattern: str) -> models.AutomatedRosterSource:
    """Test helper — lightweight source stand-in without DB."""
    return models.AutomatedRosterSource(
        id="test",
        kind=kind,
        pattern=pattern,
        created_at=datetime.now(timezone.utc),
    )
