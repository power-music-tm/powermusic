"""Create manager_requests rows (portal + automated email intake)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from app import models, schemas
from app.directory_person_match import duplicate_tags_for_person
from app.manager_request_tags import (
    MANAGER_SUBMIT_TAGS,
    TAG_CONFIRMED_DUPLICATE,
    TAG_AUTO_MAIL,
    TAG_PARTNER_REQUEST,
    TAG_SENT_BY_ADMIN,
    TAG_POTENTIAL_DUPLICATE,
    TAG_UNVERIFIED,
    TAG_VERIFIED,
    has_tag,
    merge_tags,
    normalize_tags,
)
from app.intake_persons import (
    apply_person_to_row,
    set_admin_submitted_by,
    set_auto_mail_meta,
    set_submitted_by_attribution,
    sync_display_person,
)
from app.manager_request_stats import increment_manager_request_stats
from app.request_display import allocate_request_ids


def _new_requests_query(db: Session):
    return db.query(models.ManagerRequest).filter(models.ManagerRequest.status == "new")


def manager_id_for_email(db: Session, email: str) -> Optional[str]:
    from sqlalchemy import func

    normalized = (email or "").strip().lower()
    if not normalized:
        return None
    linked = (
        db.query(models.PowermusicUser)
        .filter(
            func.lower(models.PowermusicUser.email) == normalized,
            models.PowermusicUser.role == "manager",
        )
        .first()
    )
    return str(linked.id) if linked else None


def build_tags(
    db: Session,
    person: schemas.PersonInfo,
    *,
    action: str,
    partner_id: Optional[str] = None,
    extra_tags: Optional[List[str]] = None,
) -> List[str]:
    return merge_tags(
        extra_tags,
        duplicate_tags_for_person(db, person, action=action, partner_id=partner_id),
    )


def request_duplicate_tags_for_person(
    db: Session,
    person: schemas.PersonInfo,
    action: str,
    partner_id: Optional[str] = None,
) -> List[str]:
    first = (person.firstName or "").strip().lower()
    last = (person.lastName or "").strip().lower()
    email = (person.email or "").strip().lower()
    location = (person.location or "").strip().lower()

    if not first or not last:
        return []

    confirmed = False
    potential = False

    query = db.query(models.ManagerRequest).filter(models.ManagerRequest.action == action)
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)

    for row in query.all():
        row_first = (row.person_first_name or "").strip().lower()
        row_last = (row.person_last_name or "").strip().lower()
        row_email = (row.person_email or "").strip().lower()
        row_location = (row.person_location or "").strip().lower()

        if row_first != first or row_last != last:
            continue

        if email and row_email and email == row_email:
            confirmed = True
            break

        if location and row_location and location == row_location and email and row_email and email != row_email:
            potential = True

    if confirmed:
        return [TAG_CONFIRMED_DUPLICATE]
    if potential:
        return [TAG_POTENTIAL_DUPLICATE]
    return []


def attach_auto_mail_to_request(
    db: Session,
    req: models.ManagerRequest,
    *,
    person: schemas.PersonInfo,
    manager_notes: Optional[str] = None,
    from_email: Optional[str] = None,
    received_at: Optional[datetime] = None,
    subject: Optional[str] = None,
    inbox_email: Optional[str] = None,
) -> models.ManagerRequest:
    apply_person_to_row(req, person, source="autoMail")
    # Never write roster auto text into manager_notes — that field is only for
    # notes the manager entered on the form.
    set_auto_mail_meta(
        req,
        from_email=from_email or "",
        received_at=received_at,
        subject=subject or "",
        inbox_email=inbox_email or "",
        details=(manager_notes or "").strip(),
    )
    if _looks_like_automated_notes(req.manager_notes):
        req.manager_notes = None
    req.tags = merge_tags(
        req.tags,
        [TAG_AUTO_MAIL],
        duplicate_tags_for_person(db, person, action=req.action, partner_id=req.partner_id),
    )
    sync_display_person(req)
    return req


def _looks_like_automated_notes(raw: Optional[str]) -> bool:
    text = (raw or "").strip().lower()
    if not text:
        return False
    return (
        text.startswith("automated roster email")
        or text.startswith("automated puregym email")
        or text.startswith("seed:")
    )


def verify_unverified_request(
    db: Session,
    req: models.ManagerRequest,
    *,
    person: schemas.PersonInfo,
    manager_id: Optional[str],
    manager_notes: Optional[str] = None,
) -> models.ManagerRequest:
    req.manager_id = manager_id
    apply_person_to_row(req, person, source="partner")
    # Keep form notes only. Existing auto-generated text stays out of manager_notes.
    if _looks_like_automated_notes(req.manager_notes):
        req.manager_notes = None
    if manager_notes and manager_notes.strip():
        req.manager_notes = manager_notes.strip()

    base = [t for t in (req.tags or []) if t not in {TAG_UNVERIFIED}]
    req.tags = merge_tags(
        base,
        MANAGER_SUBMIT_TAGS,
        duplicate_tags_for_person(db, person, action=req.action, partner_id=req.partner_id),
    )
    sync_display_person(req)
    return req


def attach_partner_submission_to_request(
    db: Session,
    req: models.ManagerRequest,
    *,
    person: schemas.PersonInfo,
    manager_id: Optional[str] = None,
    manager_notes: Optional[str] = None,
    is_admin_entry: bool = False,
    submitted_by: Optional[schemas.SubmittedBy] = None,
) -> models.ManagerRequest:
    """Merge a manager/admin submit onto an existing verified New request (same_person)."""
    if manager_id and not req.manager_id:
        req.manager_id = manager_id

    already_has_partner = has_tag(req.tags, TAG_PARTNER_REQUEST)

    # Admin Add Manually onto a row that already has a manager/partner submission —
    # keep the existing person/manager data, store Admin form snapshots, and tag.
    if is_admin_entry and already_has_partner:
        apply_person_to_row(req, person, source="admin")
        if submitted_by is not None:
            set_admin_submitted_by(
                req,
                first_name=submitted_by.firstName or "",
                last_name=submitted_by.lastName or "",
                email=submitted_by.email or "",
                club=submitted_by.club or "",
            )
        if manager_notes and manager_notes.strip() and not (req.manager_notes or "").strip():
            req.manager_notes = manager_notes.strip()
        req.tags = merge_tags(
            req.tags,
            [TAG_SENT_BY_ADMIN],
            duplicate_tags_for_person(db, person, action=req.action, partner_id=req.partner_id),
        )
        return req

    apply_person_to_row(req, person, source="partner")
    if _looks_like_automated_notes(req.manager_notes):
        req.manager_notes = None
    if manager_notes and manager_notes.strip():
        req.manager_notes = manager_notes.strip()

    base = [t for t in (req.tags or []) if t not in {TAG_UNVERIFIED}]
    extra = list(MANAGER_SUBMIT_TAGS)
    # Pure admin create that lands on auto-only verified (rare) stays partner-tagged;
    # Admin form is a display swap via isAdminEntry when there is no manager_id.
    req.tags = merge_tags(
        base,
        extra,
        duplicate_tags_for_person(db, person, action=req.action, partner_id=req.partner_id),
    )
    sync_display_person(req)
    return req


def intake_manager_submission(
    db: Session,
    *,
    person: schemas.PersonInfo,
    action: str,
    manager_id: Optional[str] = None,
    manager_notes: Optional[str] = None,
    partner_id: Optional[str] = None,
    new_id: Optional[str] = None,
    submitted_by: Optional[schemas.SubmittedBy] = None,
) -> models.ManagerRequest:
    """Manager portal / admin manual submit — always insert a fresh request row."""
    row = create_fresh_manager_request(
        db,
        person=person,
        action=action,
        manager_notes=manager_notes,
        manager_id=manager_id,
        partner_id=partner_id,
        extra_tags=MANAGER_SUBMIT_TAGS,
        new_id=new_id,
    )

    if submitted_by is not None:
        set_submitted_by_attribution(
            row,
            first_name=submitted_by.firstName or "",
            last_name=submitted_by.lastName or "",
            email=submitted_by.email or "",
            club=submitted_by.club or "",
        )
    return row


def intake_automated_email_request(
    db: Session,
    *,
    person: schemas.PersonInfo,
    action: str,
    manager_notes: Optional[str] = None,
    received_at: Optional[datetime] = None,
    source_email_id: Optional[str] = None,
    source_gmail_message_id: Optional[str] = None,
    from_email: Optional[str] = None,
    subject: Optional[str] = None,
    inbox_email: Optional[str] = None,
    partner_id: Optional[str] = None,
) -> models.ManagerRequest:
    """PureGym auto email — attach to verified row or store as unverified (hidden)."""
    resolved_partner_id = partner_id
    if resolved_partner_id is None and from_email:
        from app.partner_allowlists import resolve_partner_for_automated_email

        resolved_partner_id = resolve_partner_for_automated_email(
            db,
            from_email=from_email,
            inbox_email=inbox_email,
        )

    if source_gmail_message_id:
        existing = (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.source_gmail_message_id == source_gmail_message_id)
            .first()
        )
        if existing:
            return existing

    row = create_manager_request(
        db,
        person=person,
        action=action,
        manager_notes=None,
        manager_id=None,
        partner_id=resolved_partner_id,
        extra_tags=[TAG_UNVERIFIED, TAG_AUTO_MAIL],
        received_at=received_at,
        source_email_id=source_email_id,
        source_gmail_message_id=source_gmail_message_id,
    )
    set_auto_mail_meta(
        row,
        from_email=from_email or "",
        received_at=received_at,
        subject=subject or "",
        inbox_email=inbox_email or "",
        details=(manager_notes or "").strip(),
    )
    return row


def create_manager_request(
    db: Session,
    *,
    person: schemas.PersonInfo,
    action: str,
    manager_notes: Optional[str] = None,
    manager_user_id: Optional[str] = None,
    manager_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    extra_tags: Optional[List[str]] = None,
    new_id: Optional[str] = None,
    received_at: Optional[datetime] = None,
    source_email_id: Optional[str] = None,
    source_gmail_message_id: Optional[str] = None,
    allow_existing_lookup: bool = True,
) -> models.ManagerRequest:
    if allow_existing_lookup and source_gmail_message_id:
        existing = (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.source_gmail_message_id == source_gmail_message_id)
            .first()
        )
        if existing:
            return existing

    if allow_existing_lookup and source_email_id:
        existing = (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.source_email_id == source_email_id)
            .first()
        )
        if existing:
            return existing

    resolved_manager_id = manager_id
    if resolved_manager_id is None and manager_user_id and manager_user_id != "dev-bypass":
        resolved_manager_id = manager_user_id

    row = models.ManagerRequest(
        id=new_id or allocate_request_ids(db, 1)[0],
        received_at=received_at or datetime.now(timezone.utc),
        manager_id=resolved_manager_id,
        partner_id=partner_id,
        person_first_name=person.firstName,
        person_last_name=person.lastName,
        person_email=person.email,
        person_location=person.location or "",
        role=person.role or None,
        action=action,
        manager_notes=manager_notes,
        tags=build_tags(db, person, action=action, partner_id=partner_id, extra_tags=extra_tags),
        status="new",
        source_email_id=source_email_id,
        source_gmail_message_id=source_gmail_message_id,
        intake_persons={},
    )
    normalized_extra = normalize_tags(extra_tags)
    if resolved_manager_id or has_tag(normalized_extra, TAG_PARTNER_REQUEST):
        apply_person_to_row(row, person, source="partner")
    elif has_tag(normalized_extra, TAG_AUTO_MAIL):
        apply_person_to_row(row, person, source="autoMail")
    if getattr(person, "directorFirst", None) or getattr(person, "directorLast", None):
        from app.intake_persons import set_director_fields
        set_director_fields(row, getattr(person, "directorFirst", None) or "", getattr(person, "directorLast", None) or "")
    sync_display_person(row)
    db.add(row)
    db.flush()
    from app.duplicate_group_service import process_request_grouping
    process_request_grouping(db, row)
    return row


def create_fresh_manager_request(
    db: Session,
    *,
    person: schemas.PersonInfo,
    action: str,
    manager_notes: Optional[str] = None,
    manager_user_id: Optional[str] = None,
    manager_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    extra_tags: Optional[List[str]] = None,
    new_id: Optional[str] = None,
    received_at: Optional[datetime] = None,
) -> models.ManagerRequest:
    """Insert-only helper for manager/admin submissions.

    This path never performs an existing-row lookup and cannot reuse or
    overwrite a pending request.
    """
    return create_manager_request(
        db,
        person=person,
        action=action,
        manager_notes=manager_notes,
        manager_user_id=manager_user_id,
        manager_id=manager_id,
        partner_id=partner_id,
        extra_tags=extra_tags,
        new_id=new_id,
        received_at=received_at,
        allow_existing_lookup=False,
    )


def create_handled_manual_request(
    db: Session,
    *,
    person: schemas.PersonInfo,
    action: str,
    submitted_by: Optional[schemas.SubmittedBy] = None,
    manager_notes: Optional[str] = None,
    admin_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    new_id: Optional[str] = None,
    outcome: Optional[str] = None,
) -> models.ManagerRequest:
    row = create_fresh_manager_request(
        db,
        person=person,
        action=action,
        manager_notes=manager_notes,
        extra_tags=MANAGER_SUBMIT_TAGS,
        partner_id=partner_id,
        new_id=new_id,
    )
    row.status = "handled"
    row.outcome = outcome or ("Added" if action == "Add" else "Removed")
    row.handled_at = datetime.now(timezone.utc)
    if admin_id and admin_id != "dev-bypass":
        row.handled_by_admin_id = admin_id
    if submitted_by is not None:
        set_submitted_by_attribution(
            row,
            first_name=submitted_by.firstName or "",
            last_name=submitted_by.lastName or "",
            email=submitted_by.email or "",
            club=submitted_by.club or "",
        )
    return row
