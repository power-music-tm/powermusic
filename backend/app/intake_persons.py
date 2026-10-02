"""Persist partner vs auto-mail person snapshots on manager_requests."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from app import models, schemas
from app.manager_request_tags import TAG_AUTO_MAIL, TAG_PARTNER_REQUEST, TAG_SENT_BY_ADMIN, has_tag
from app.person_compare import person_from_mapping, person_to_mapping


def get_intake_persons(req: models.ManagerRequest) -> Dict[str, Any]:
    raw = req.intake_persons or {}
    if not isinstance(raw, dict):
        return {}
    return raw


def get_partner_snapshot(req: models.ManagerRequest) -> Optional[schemas.PersonInfo]:
    return person_from_mapping(get_intake_persons(req).get("partner"))


def get_auto_mail_snapshot(req: models.ManagerRequest) -> Optional[schemas.PersonInfo]:
    return person_from_mapping(get_intake_persons(req).get("autoMail"))


def get_admin_snapshot(req: models.ManagerRequest) -> Optional[schemas.PersonInfo]:
    return person_from_mapping(get_intake_persons(req).get("admin"))


def get_auto_mail_meta(req: models.ManagerRequest) -> Dict[str, Any]:
    raw = get_intake_persons(req).get("autoMailMeta")
    return raw if isinstance(raw, dict) else {}


def get_submitted_by_attribution(req: models.ManagerRequest) -> Dict[str, str]:
    """Admin-entered manager details when the row is not linked to a manager user."""
    raw = get_intake_persons(req).get("submittedBy")
    if not isinstance(raw, dict):
        return {"firstName": "", "lastName": "", "email": "", "club": ""}
    return {
        "firstName": str(raw.get("firstName") or "").strip(),
        "lastName": str(raw.get("lastName") or "").strip(),
        "email": str(raw.get("email") or "").strip(),
        "club": str(raw.get("club") or "").strip(),
    }


def get_admin_submitted_by(req: models.ManagerRequest) -> Dict[str, str]:
    """Manager details entered on Admin form when overlaying an existing manager request."""
    raw = get_intake_persons(req).get("adminSubmittedBy")
    if isinstance(raw, dict) and any(str(raw.get(k) or "").strip() for k in ("firstName", "lastName", "email", "club")):
        return {
            "firstName": str(raw.get("firstName") or "").strip(),
            "lastName": str(raw.get("lastName") or "").strip(),
            "email": str(raw.get("email") or "").strip(),
            "club": str(raw.get("club") or "").strip(),
        }
    # Legacy overlays wrote attribution into submittedBy while manager_id stayed set.
    if has_tag(req.tags or [], TAG_SENT_BY_ADMIN) and req.manager_id:
        return get_submitted_by_attribution(req)
    return {"firstName": "", "lastName": "", "email": "", "club": ""}


def set_submitted_by_attribution(
    req: models.ManagerRequest,
    *,
    first_name: str = "",
    last_name: str = "",
    email: str = "",
    club: str = "",
) -> None:
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    mail = (email or "").strip()
    club_name = (club or "").strip()
    if not first and not last and not mail and not club_name:
        return
    current = dict(get_intake_persons(req))
    current["submittedBy"] = {
        "firstName": first,
        "lastName": last,
        "email": mail,
        "club": club_name,
    }
    req.intake_persons = current


def get_director_fields(req: models.ManagerRequest) -> Dict[str, str]:
    """Return the Director First/Last Name stored on a Health Fitness request.

    These are request-level data-entry fields (not manager identity).
    They are stored under intake_persons["director"] to keep them
    completely separate from submittedBy (which represents the manager).
    """
    raw = get_intake_persons(req).get("director")
    if not isinstance(raw, dict):
        return {"firstName": "", "lastName": ""}
    return {
        "firstName": str(raw.get("firstName") or "").strip(),
        "lastName": str(raw.get("lastName") or "").strip(),
    }


def set_director_fields(
    req: models.ManagerRequest,
    first_name: str = "",
    last_name: str = "",
) -> None:
    """Persist Director First/Last Name for a Health Fitness request.

    Clears the entry if both values are empty.
    """
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    current = dict(get_intake_persons(req))
    if not first and not last:
        current.pop("director", None)
    else:
        current["director"] = {"firstName": first, "lastName": last}
    req.intake_persons = current


def set_admin_submitted_by(
    req: models.ManagerRequest,
    *,
    first_name: str = "",
    last_name: str = "",
    email: str = "",
    club: str = "",
) -> None:
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    mail = (email or "").strip()
    club_name = (club or "").strip()
    current = dict(get_intake_persons(req))
    if not first and not last and not mail and not club_name:
        current.pop("adminSubmittedBy", None)
    else:
        current["adminSubmittedBy"] = {
            "firstName": first,
            "lastName": last,
            "email": mail,
            "club": club_name,
        }
    req.intake_persons = current


def set_auto_mail_meta(
    req: models.ManagerRequest,
    *,
    from_email: str = "",
    received_at: Optional[Any] = None,
    subject: str = "",
    inbox_email: str = "",
    details: str = "",
) -> None:
    current = dict(get_intake_persons(req))
    meta = dict(get_auto_mail_meta(req))
    if from_email:
        meta["fromEmail"] = from_email
    if subject:
        meta["subject"] = subject
    if inbox_email:
        meta["inboxEmail"] = inbox_email
    if details:
        meta["details"] = details
    if received_at is not None:
        meta["receivedAt"] = (
            received_at.isoformat() if hasattr(received_at, "isoformat") else received_at
        )
    current["autoMailMeta"] = meta
    req.intake_persons = current


def _set_snapshot(req: models.ManagerRequest, key: str, person: schemas.PersonInfo) -> None:
    current = dict(get_intake_persons(req))
    current[key] = person_to_mapping(person)
    req.intake_persons = current


def apply_person_to_row(
    req: models.ManagerRequest,
    person: schemas.PersonInfo,
    *,
    source: Literal["partner", "autoMail", "admin"],
) -> None:
    _set_snapshot(req, source, person)
    if source != "admin":
        sync_display_person(req)


def sync_display_person(req: models.ManagerRequest) -> None:
    """Prefer manager submission for list/detail person fields when both exist."""
    partner = get_partner_snapshot(req)
    auto_mail = get_auto_mail_snapshot(req)
    chosen = partner or auto_mail
    if chosen is None:
        return
    req.person_first_name = chosen.firstName or ""
    req.person_last_name = chosen.lastName or ""
    req.person_email = chosen.email or ""
    req.person_location = chosen.location or ""
    if hasattr(req, "role"):
        req.role = chosen.role or None


def bootstrap_intake_persons(req: models.ManagerRequest) -> None:
    """Backfill snapshots from legacy single person columns when JSON is empty."""
    if get_intake_persons(req):
        return

    person = schemas.PersonInfo(
        firstName=req.person_first_name,
        lastName=req.person_last_name,
        email=req.person_email,
        location=req.person_location,
        role=getattr(req, "role", None),
    )
    tags = req.tags or []
    current: Dict[str, Any] = {}

    if has_tag(tags, TAG_PARTNER_REQUEST) or req.manager_id:
        current["partner"] = person_to_mapping(person)
    if has_tag(tags, TAG_AUTO_MAIL) or req.source_gmail_message_id:
        current["autoMail"] = person_to_mapping(person)
    if has_tag(tags, TAG_SENT_BY_ADMIN):
        current["admin"] = person_to_mapping(person)

    if current:
        req.intake_persons = current


# ── Lifecycle history helpers ──────────────────────────────────────────────────


def get_lifecycle_history(req: models.ManagerRequest) -> List[Dict[str, Any]]:
    """Return the append-only lifecycle history list stored inside intake_persons.

    Each entry is a dict with at minimum:
        id        – unique event identifier
        type      – event type string ("manager_request", "handled", etc.)
        at        – ISO-8601 timestamp string
        action    – "Add" | "Remove" | ...
        title     – human-readable title
    """
    raw = get_intake_persons(req).get("history")
    if isinstance(raw, list):
        return list(raw)
    return []


def append_lifecycle_history(
    req: models.ManagerRequest,
    events: List[Dict[str, Any]],
) -> None:
    """Append one or more lifecycle event dicts to intake_persons["history"].

    This is the only write path — the history list is append-only.
    Caller must assign the updated intake_persons back (already done here).
    """
    if not events:
        return
    current = dict(get_intake_persons(req))
    existing: List[Dict[str, Any]] = []
    if isinstance(current.get("history"), list):
        existing = list(current["history"])
    existing.extend(events)
    current["history"] = existing
    req.intake_persons = current
