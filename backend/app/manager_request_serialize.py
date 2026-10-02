"""Serialize manager_requests for API responses."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime

from sqlalchemy.orm import Session

from app import models
from app.directory_person_match import (
    find_directory_conflict,
    request_person_for_match,
)
from app.duplicate_group_service import compute_group_classification_summary
from app.manager_request_views import is_request_unread
from app.manager_request_tags import (
    TAG_ALREADY_EXISTS,
    TAG_AUTO_MAIL,
    TAG_CONFIRMED_DUPLICATE,
    TAG_PARTNER_REQUEST,
    TAG_POTENTIAL_DUPLICATE,
    TAG_VERIFIED,
    has_tag,
    merge_tags,
)
from app.request_display import parse_request_display_number
from app.request_match_summary import build_directory_match, build_intake_match
from app.user_display import (
    hydrate_request_users,
    resolve_handled_by_name,
    resolve_manager_fields,
    resolve_manager_name,
)


def _directory_conflict_for_request(
    db: Session,
    req: models.ManagerRequest,
) -> Optional[models.ManagerRequest]:
    person = request_person_for_match(req)
    from app.directory_person_match import _probe_handled_rows, _is_gll
    from app.duplicate_matching import is_healthtech_partner
    is_ht = is_healthtech_partner(db, req.partner_id)
    gll = _is_gll(db, req.partner_id)

    return find_directory_conflict(
        person=person,
        action=req.action or "",
        directory_rows=_probe_handled_rows(db, person, partner_id=req.partner_id),
        is_healthtech=is_ht,
        is_gll=gll,
        db=db,
        req_id=req.id,
    )


def _effective_tags(
    req: models.ManagerRequest,
    directory_row: Optional[models.ManagerRequest],
) -> List[str]:
    tags = list(req.tags or [])
    if directory_row:
        from app.manager_request_tags import TAG_ALREADY_REMOVED, TAG_ALREADY_EXISTS
        if directory_row.outcome == "Removed":
            return merge_tags(tags, [TAG_ALREADY_REMOVED])
        return merge_tags(tags, [TAG_ALREADY_EXISTS])
    return tags


def _connected_inbox_email(db: Session) -> str:
    row = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.status == "Connected")
        .order_by(models.EmailAccount.connected_at.desc().nullslast())
        .first()
    )
    return (row.email if row else "") or ""


def _backfill_auto_mail_from_gmail(
    db: Session,
    req: models.ManagerRequest,
) -> Dict[str, Any]:
    """Recover sender/inbox for older roster intakes that never stored Email rows."""
    from app.intake_persons import get_auto_mail_meta, set_auto_mail_meta
    from app.pilot2 import gmail as gmail_api

    gmail_id = (req.source_gmail_message_id or "").strip()
    meta = get_auto_mail_meta(req)
    if not gmail_id or meta.get("fromEmailLookupFailed") or meta.get("fromEmail"):
        return {}
    # Demo / synthetic ids are never recoverable from Gmail.
    if gmail_id.startswith("demo-") or gmail_id.startswith("test-"):
        return {}

    accounts = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.status == "Connected")
        .all()
    )
    for account in accounts:
        if not (account.oauth_refresh_token or "").strip():
            continue
        try:
            message = gmail_api.fetch_message(account, gmail_id)
        except Exception:
            continue
        if not message:
            continue
        set_auto_mail_meta(
            req,
            from_email=message.from_email or "",
            received_at=message.received_at or req.received_at,
            subject=message.subject or "",
            inbox_email=account.email or "",
        )
        try:
            db.add(req)
            db.commit()
        except Exception:
            db.rollback()
        return {
            "fromEmail": message.from_email or "",
            "subject": message.subject or "",
            "receivedAt": message.received_at or req.received_at,
            "inboxEmail": account.email or "",
        }

    # Avoid hammering Gmail when the message is gone / wrong inbox.
    current = dict(get_auto_mail_meta(req))
    current["fromEmailLookupFailed"] = True
    if not current.get("inboxEmail"):
        inbox = _connected_inbox_email(db)
        if inbox:
            current["inboxEmail"] = inbox
    persons = dict(req.intake_persons or {}) if isinstance(req.intake_persons, dict) else {}
    persons["autoMailMeta"] = current
    req.intake_persons = persons
    try:
        db.add(req)
        db.commit()
    except Exception:
        db.rollback()
    return {"inboxEmail": current.get("inboxEmail") or ""} if current.get("inboxEmail") else {}


def _prefetch_source_emails(
    db: Session, requests: List[models.ManagerRequest],
) -> Dict[str, models.Email]:
    """Map request id → source Email row in one/two queries (list path)."""
    by_req: Dict[str, models.Email] = {}
    email_ids = [r.source_email_id for r in requests if r.source_email_id]
    gmail_ids = [
        r.source_gmail_message_id
        for r in requests
        if not r.source_email_id and r.source_gmail_message_id
    ]
    by_id: Dict[Any, models.Email] = {}
    by_gmail: Dict[str, models.Email] = {}
    if email_ids:
        for row in db.query(models.Email).filter(models.Email.id.in_(email_ids)).all():
            by_id[row.id] = row
    if gmail_ids:
        for row in (
            db.query(models.Email)
            .filter(models.Email.gmail_message_id.in_(gmail_ids))
            .all()
        ):
            by_gmail[row.gmail_message_id] = row
    for req in requests:
        if req.source_email_id and req.source_email_id in by_id:
            by_req[req.id] = by_id[req.source_email_id]
        elif req.source_gmail_message_id and req.source_gmail_message_id in by_gmail:
            by_req[req.id] = by_gmail[req.source_gmail_message_id]
    return by_req


def _automated_email_meta(
    db: Session,
    req: models.ManagerRequest,
    *,
    allow_gmail_lookup: bool = False,
    persist_side_effects: bool = True,
    email_row: Optional[models.Email] = None,
    connected_inbox: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Sender + inbox + time for roster auto-mail, when present.

    Keep allow_gmail_lookup=False on list endpoints — live Gmail recovery per row
    makes New Requests take tens of seconds and the UI falls back to a stale cache.
    Set persist_side_effects=False on list paths to avoid per-row commits.
    """
    from app.intake_persons import get_auto_mail_meta, set_auto_mail_meta

    if email_row is None:
        if req.source_email_id:
            email_row = (
                db.query(models.Email)
                .filter(models.Email.id == req.source_email_id)
                .first()
            )
        elif req.source_gmail_message_id:
            email_row = (
                db.query(models.Email)
                .filter(models.Email.gmail_message_id == req.source_gmail_message_id)
                .first()
            )

    meta = get_auto_mail_meta(req)
    inbox_email = (
        (email_row.account_email if email_row else None)
        or meta.get("inboxEmail")
        or ""
    )
    raw_from = (email_row.from_email if email_row else None) or meta.get("fromEmail") or ""
    original_from = ""
    if email_row is not None:
        original_from = (getattr(email_row, "original_from_email", None) or "").strip()
    # Prefer original sender when this was a forward into the connected inbox.
    if (
        original_from
        and inbox_email
        and raw_from.lower() == inbox_email.lower()
    ):
        from_email = original_from
    else:
        from_email = raw_from
    subject = (email_row.subject if email_row else None) or meta.get("subject") or ""
    received_at = (
        (email_row.received_at if email_row else None)
        or meta.get("receivedAt")
        or req.received_at
    )
    _, notes_auto = _split_manager_and_automated_notes(req.manager_notes)
    details = (meta.get("details") or "").strip() or notes_auto or subject or ""

    has_auto_tag = TAG_AUTO_MAIL in (req.tags or [])
    if (
        allow_gmail_lookup
        and not from_email
        and req.source_gmail_message_id
        and (has_auto_tag or req.source_gmail_message_id)
        and not meta.get("fromEmailLookupFailed")
    ):
        recovered = _backfill_auto_mail_from_gmail(db, req)
        if recovered:
            from_email = recovered.get("fromEmail") or from_email
            subject = recovered.get("subject") or subject
            inbox_email = recovered.get("inboxEmail") or inbox_email
            received_at = recovered.get("receivedAt") or received_at

    if not inbox_email and (has_auto_tag or req.source_gmail_message_id or from_email):
        inbox_email = (
            connected_inbox
            if connected_inbox is not None
            else _connected_inbox_email(db)
        )
        if persist_side_effects and inbox_email and not meta.get("inboxEmail"):
            set_auto_mail_meta(req, inbox_email=inbox_email)
            try:
                db.add(req)
                db.commit()
            except Exception:
                db.rollback()

    # Persist details migrated out of polluted manager_notes (legacy rows).
    if persist_side_effects and notes_auto and not (meta.get("details") or "").strip():
        manager_only, _ = _split_manager_and_automated_notes(req.manager_notes)
        set_auto_mail_meta(req, details=notes_auto)
        req.manager_notes = manager_only
        try:
            db.add(req)
            db.commit()
        except Exception:
            db.rollback()

    if (
        email_row is None
        and not meta
        and not has_auto_tag
        and not req.source_gmail_message_id
        and not from_email
        and not inbox_email
        and not details
    ):
        return None

    if (
        not has_auto_tag
        and not req.source_gmail_message_id
        and not from_email
        and not inbox_email
        and not details
    ):
        return None

    return {
        "fromEmail": from_email,
        "subject": subject,
        "receivedAt": received_at,
        "inboxEmail": inbox_email,
        "details": details,
    }


def _looks_like_automated_notes(raw: Optional[str]) -> bool:
    text = (raw or "").strip().lower()
    if not text:
        return False
    return text.startswith("automated roster email") or text.startswith("automated puregym email")


def _looks_like_seed_notes(raw: Optional[str]) -> bool:
    text = (raw or "").strip().lower()
    return text.startswith("seed:")


def _split_manager_and_automated_notes(raw: Optional[str]) -> Tuple[Optional[str], str]:
    """Return (manager_form_notes, automated_details). Seed text is dropped."""
    text = (raw or "").strip()
    if not text:
        return None, ""
    if _looks_like_seed_notes(text):
        return None, ""
    if _looks_like_automated_notes(text):
        return None, text

    parts = [part.strip() for part in re.split(r"\n{2,}", text) if part.strip()]
    manager_parts: List[str] = []
    auto_parts: List[str] = []
    for part in parts:
        if _looks_like_seed_notes(part):
            continue
        if _looks_like_automated_notes(part):
            auto_parts.append(part)
        else:
            manager_parts.append(part)
    manager = "\n\n".join(manager_parts).strip() or None
    auto = "\n\n".join(auto_parts).strip()
    return manager, auto


_REVIEW_TAGS = frozenset(
    {TAG_ALREADY_EXISTS, TAG_CONFIRMED_DUPLICATE, TAG_POTENTIAL_DUPLICATE}
)


def _needs_review(tags: List[str], duplicate_group_id: Optional[str] = None) -> bool:
    """True when the request carries any duplicate, conflict, or group tag."""
    return bool(set(tags or []) & _REVIEW_TAGS) or bool(duplicate_group_id)


def _group_member_count(db: Optional[Session], req: models.ManagerRequest) -> int:
    """Cheap COUNT of members in req's duplicate group (0 if not in a group)."""
    group_id = getattr(req, "duplicate_group_id", None)
    if not group_id or db is None:
        return 0
    from sqlalchemy import func as sa_func
    result = (
        db.query(sa_func.count(models.ManagerRequest.id))
        .filter(models.ManagerRequest.duplicate_group_id == group_id)
        .scalar()
    )
    return int(result or 0)


_PARTNER_CACHE: Dict[str, Tuple[str, str]] = {}


def _resolve_partner_info(db: Optional[Session], partner_id: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    if not partner_id:
        return None, None
    if partner_id in _PARTNER_CACHE:
        return _PARTNER_CACHE[partner_id]
    if db is None:
        return partner_id, partner_id.lower()
    partner = db.query(models.Partner).filter(models.Partner.id == partner_id).first()
    if not partner:
        res = (partner_id, partner_id.lower())
    else:
        name = partner.name
        slug = name.lower().replace(" ", "-")
        res = (name, slug)
    _PARTNER_CACHE[partner_id] = res
    return res


def request_to_api_dict(
    req: models.ManagerRequest,
    *,
    manager_user: Optional[models.PowermusicUser] = None,
    admin_user: Optional[models.PowermusicUser] = None,
    directory_row: Optional[models.ManagerRequest] = None,
    db: Optional[Session] = None,
    email_row: Optional[models.Email] = None,
    connected_inbox: Optional[str] = None,
    persist_auto_mail_side_effects: bool = True,
    group_classification_summary: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    partner_name, partner_slug = _resolve_partner_info(db, getattr(req, "partner_id", None))
    if manager_user is None:
        manager_user = getattr(req, "_manager_user", None)
    if admin_user is None:
        admin_user = getattr(req, "_admin_user", None)

    submitted_by = resolve_manager_fields(req, manager_user=manager_user)
    created_by = resolve_manager_name(req, manager_user=manager_user)
    intake_match = build_intake_match(req)
    directory_match = build_directory_match(req, directory_row)
    tags = _effective_tags(req, directory_row)
    manager_notes, _ = _split_manager_and_automated_notes(req.manager_notes)

    # Admin "Add Manually" creates partner/verified rows with no manager_id.
    # Prefer linked manager user; otherwise use admin-entered attribution.
    if not req.manager_id:
        from app.intake_persons import get_submitted_by_attribution

        attributed = get_submitted_by_attribution(req)
        if any(attributed.values()):
            submitted_by = {
                "firstName": attributed["firstName"] or submitted_by.get("firstName") or "",
                "lastName": attributed["lastName"] or submitted_by.get("lastName") or "",
                "email": attributed["email"] or submitted_by.get("email") or "",
                "club": attributed["club"] or submitted_by.get("club") or "",
            }
        if has_tag(tags, TAG_PARTNER_REQUEST):
            # Keep Manual entry marker when admin left club blank.
            if not (submitted_by.get("club") or "").strip():
                submitted_by = {**submitted_by, "club": "Manual entry"}
            if not created_by:
                created_by = "Admin"

    from app.intake_persons import get_director_fields
    director = get_director_fields(req)

    payload = {
        "id": req.id,
        "displayId": getattr(req, "displayId", None) or parse_request_display_number(req.id),
        "receivedAt": req.received_at,
        "handledAt": req.handled_at,
        "submittedBy": submitted_by,
        "person": {
            "firstName": req.person_first_name,
            "lastName": req.person_last_name,
            "email": req.person_email,
            "location": req.person_location,
            "role": getattr(req, "role", None),
            "directorFirst": director["firstName"] or None,
            "directorLast": director["lastName"] or None,
        },
        "role": getattr(req, "role", None),
        "action": req.action,
        "notes": manager_notes,
        "managerNotes": manager_notes,
        "tags": tags,
        "createdBy": created_by,
        "status": req.status,
        "handledBy": resolve_handled_by_name(req, admin_user=admin_user),
        "managerId": str(req.manager_id) if req.manager_id else None,
        "handledByAdminId": str(req.handled_by_admin_id) if req.handled_by_admin_id else None,
        "partnerId": getattr(req, "partner_id", None),
        "partnerName": partner_name,
        "partnerSlug": partner_slug,
        # Duplicate group fields
        "duplicateGroupId": getattr(req, "duplicate_group_id", None),
        "needsReview": _needs_review(tags, getattr(req, "duplicate_group_id", None)),
        "groupMemberCount": _group_member_count(db, req),
        # Aggregated classification summary (only present for group representatives)
        "groupClassificationSummary": group_classification_summary,
    }
    if intake_match:
        payload["intakeMatch"] = intake_match
    if directory_match:
        payload["directoryMatch"] = directory_match

    from app.intake_persons import get_admin_snapshot, get_admin_submitted_by
    from app.person_compare import person_to_mapping

    admin_person = get_admin_snapshot(req)
    if admin_person is not None:
        payload["adminPerson"] = person_to_mapping(admin_person)
    admin_submitted = get_admin_submitted_by(req)
    if any(admin_submitted.values()):
        payload["adminSubmittedBy"] = admin_submitted

    if director["firstName"] or director["lastName"]:
        payload["directorFirst"] = director["firstName"]
        payload["directorLast"] = director["lastName"]
    else:
        payload["directorFirst"] = None
        payload["directorLast"] = None

    if db is not None:
        automated = _automated_email_meta(
            db,
            req,
            email_row=email_row,
            connected_inbox=connected_inbox,
            persist_side_effects=persist_auto_mail_side_effects,
        )
        if automated is not None:
            payload["automatedEmail"] = automated
    return payload


def requests_to_api_dicts(db: Session, requests: List[models.ManagerRequest]) -> List[Dict[str, Any]]:
    rows = list(requests)
    hydrate_request_users(db, rows)
    # One directory load for the whole page — per-row probes were ~0.4s each over
    # the remote DB and made /admin/requests/page exceed the frontend timeout.
    from app.directory_person_match import handled_directory_rows
    from app import models as _models

    directory_rows = handled_directory_rows(db) if rows else []
    email_by_req = _prefetch_source_emails(db, rows) if rows else {}
    connected_inbox = _connected_inbox_email(db) if rows else ""

    # ── Batch-compute classification summaries for all grouped rows ──────────
    # Each row that appears in this list is the representative (latest) for its
    # group (guaranteed by _visible_new_requests_query). We load all group
    # members in ONE query then compute summaries in Python.
    group_ids = list({req.duplicate_group_id for req in rows if req.duplicate_group_id})
    group_summaries: Dict[str, Dict[str, Any]] = {}
    if group_ids:
        # Fetch the DuplicateGroup objects
        groups_by_id = {
            g.id: g
            for g in db.query(_models.DuplicateGroup)
            .filter(_models.DuplicateGroup.id.in_(group_ids))
            .all()
        }
        # Fetch ALL members for those groups in one query
        all_members_raw = (
            db.query(_models.ManagerRequest)
            .filter(_models.ManagerRequest.duplicate_group_id.in_(group_ids))
            .all()
        )
        # Group members by group_id
        from collections import defaultdict
        members_by_group: Dict[str, List[_models.ManagerRequest]] = defaultdict(list)
        for m in all_members_raw:
            if m.duplicate_group_id:
                members_by_group[m.duplicate_group_id].append(m)
        # Compute each group's summary
        for gid, group in groups_by_id.items():
            group_summaries[gid] = compute_group_classification_summary(
                db, group, members=members_by_group.get(gid, [])
            )

    results: List[Dict[str, Any]] = []
    for req in rows:
        person = request_person_for_match(req)
        directory_row = find_directory_conflict(
            person=person,
            action=req.action or "",
            directory_rows=[row for row in directory_rows if not req.partner_id or row.partner_id == req.partner_id],
            db=db,
            req_id=req.id,
        )
        summary = group_summaries.get(req.duplicate_group_id) if req.duplicate_group_id else None
        results.append(
            request_to_api_dict(
                req,
                directory_row=directory_row,
                db=db,
                email_row=email_by_req.get(req.id),
                connected_inbox=connected_inbox,
                persist_auto_mail_side_effects=False,
                group_classification_summary=summary,
            ),
        )
    return results


def _manager_source_for_directory_person(
    req: models.ManagerRequest,
    *,
    db: Optional[Session],
    related_rows: Optional[List[models.ManagerRequest]],
    group_by_directory_id: Optional[Dict[str, models.DuplicateGroup]] = None,
) -> Optional[models.ManagerRequest]:
    """For merge-created Directory rows missing manager, recover from the source request.

    Preference: linked group's representative / newest member, then related
    GroupResolved rows that still carry manager attribution.
    """
    from app.intake_persons import get_admin_submitted_by, get_submitted_by_attribution

    def _has_manager(row: models.ManagerRequest) -> bool:
        if row.manager_id or getattr(row, "_manager_user", None):
            return True
        if any(get_submitted_by_attribution(row).values()):
            return True
        if any(get_admin_submitted_by(row).values()):
            return True
        return False

    # 1) Linked duplicate group (set on merge resolve).
    group = None
    if group_by_directory_id is not None:
        group = group_by_directory_id.get(req.id)
    elif db is not None:
        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.directory_person_id == req.id)
            .first()
        )
    if group is not None and db is not None:
        from app.duplicate_group_service import _current_request_member, get_group_members

        members = get_group_members(db, group.id)
        if members:
            hydrate_request_users(db, members)
            source = _current_request_member(
                members,
                representative_request_id=group.representative_request_id,
            )
            if source is not None and _has_manager(source):
                return source
            for member in sorted(
                members,
                key=lambda m: m.received_at or datetime.min,
                reverse=True,
            ):
                if _has_manager(member):
                    return member

    # 2) Related history rows (same email), prefer GroupResolved with manager.
    candidates = [r for r in (related_rows or []) if r.id != req.id]
    candidates.sort(key=lambda m: m.received_at or datetime.min, reverse=True)
    for row in candidates:
        if (row.outcome or "") == "GroupResolved" and _has_manager(row):
            return row
    for row in candidates:
        if _has_manager(row):
            return row
    return None


def directory_person_to_api_dict(
    req: models.ManagerRequest,
    *,
    manager_user: Optional[models.PowermusicUser] = None,
    admin_user: Optional[models.PowermusicUser] = None,
    db: Optional[Session] = None,
    related_rows: Optional[List[models.ManagerRequest]] = None,
    group_by_directory_id: Optional[Dict[str, models.DuplicateGroup]] = None,
) -> Dict[str, Any]:
    partner_name, partner_slug = _resolve_partner_info(db, getattr(req, "partner_id", None))
    if manager_user is None:
        manager_user = getattr(req, "_manager_user", None)
    if admin_user is None:
        admin_user = getattr(req, "_admin_user", None)

    manager_fields = resolve_manager_fields(req, manager_user=manager_user)
    manager_name = resolve_manager_name(req, manager_user=manager_user)
    handled_by = resolve_handled_by_name(req, admin_user=admin_user)
    manager_notes, _ = _split_manager_and_automated_notes(req.manager_notes)

    if not req.manager_id:
        from app.intake_persons import get_submitted_by_attribution

        attributed = get_submitted_by_attribution(req)
        if any(attributed.values()):
            manager_fields = {
                "firstName": attributed["firstName"] or manager_fields.get("firstName") or "",
                "lastName": attributed["lastName"] or manager_fields.get("lastName") or "",
                "email": attributed["email"] or manager_fields.get("email") or "",
                "club": attributed["club"] or manager_fields.get("club") or "",
            }
            manager_name = (
                f"{manager_fields['firstName']} {manager_fields['lastName']}".strip()
                or manager_name
            )

    # Previously merged Directory rows often lack manager fields — recover from
    # the current/representative request of the linked group.
    if not (manager_name or "").strip() and not (manager_fields.get("email") or "").strip():
        source = _manager_source_for_directory_person(
            req,
            db=db,
            related_rows=related_rows,
            group_by_directory_id=group_by_directory_id,
        )
        if source is not None:
            source_user = getattr(source, "_manager_user", None)
            manager_fields = resolve_manager_fields(source, manager_user=source_user)
            manager_name = resolve_manager_name(source, manager_user=source_user)
            if not source.manager_id:
                from app.intake_persons import get_submitted_by_attribution

                attributed = get_submitted_by_attribution(source)
                if any(attributed.values()):
                    manager_fields = {
                        "firstName": attributed["firstName"] or manager_fields.get("firstName") or "",
                        "lastName": attributed["lastName"] or manager_fields.get("lastName") or "",
                        "email": attributed["email"] or manager_fields.get("email") or "",
                        "club": attributed["club"] or manager_fields.get("club") or "",
                    }
                    manager_name = (
                        f"{manager_fields['firstName']} {manager_fields['lastName']}".strip()
                        or manager_name
                    )
            if not manager_notes and source.manager_notes:
                manager_notes, _ = _split_manager_and_automated_notes(source.manager_notes)

    history_source = related_rows if related_rows is not None else [req]
    request_history = _build_directory_request_history(db, history_source)

    from app.intake_persons import get_director_fields
    director = get_director_fields(req)
    if not (director["firstName"] or director["lastName"]):
        source = _manager_source_for_directory_person(
            req,
            db=db,
            related_rows=related_rows,
            group_by_directory_id=group_by_directory_id,
        )
        if source is not None:
            source_director = get_director_fields(source)
            if source_director["firstName"] or source_director["lastName"]:
                director = source_director
        if not (director["firstName"] or director["lastName"]) and related_rows:
            for r_row in related_rows:
                rd = get_director_fields(r_row)
                if rd["firstName"] or rd["lastName"]:
                    director = rd
                    break

    return {
        "id": req.id,
        "displayId": parse_request_display_number(req.id),
        "firstName": req.person_first_name,
        "lastName": req.person_last_name,
        "email": req.person_email,
        "location": req.person_location,
        "role": getattr(req, "role", None),
        "directorFirst": director["firstName"] or None,
        "directorLast": director["lastName"] or None,
        "person": {
            "firstName": req.person_first_name,
            "lastName": req.person_last_name,
            "email": req.person_email,
            "location": req.person_location,
            "role": getattr(req, "role", None),
            "directorFirst": director["firstName"] or None,
            "directorLast": director["lastName"] or None,
        },
        "status": req.outcome or "",
        "action": req.action or "",
        "dateAdded": req.handled_at,
        "addedBy": handled_by,
        "managerName": manager_name,
        "handledBy": handled_by,
        "managerEmail": manager_fields["email"],
        "club": manager_fields["club"],
        "sourceRequestId": req.id,
        "sourceRequestNumber": parse_request_display_number(req.id),
        "requestReceivedAt": req.received_at,
        "managerNotes": manager_notes,
        "adminNotes": req.admin_notes,
        "notes": manager_notes,
        "archivedAt": req.archived_at,
        "requestHistory": request_history,
        "partnerId": getattr(req, "partner_id", None),
        "partnerName": partner_name,
        "partnerSlug": partner_slug,
    }


def _light_auto_mail_snapshot(req: models.ManagerRequest) -> Optional[Dict[str, Any]]:
    """Auto-mail summary without DB round-trips (safe for list serialization)."""
    from app.intake_persons import get_auto_mail_meta

    tags = req.tags or []
    meta = get_auto_mail_meta(req)
    _, notes_auto = _split_manager_and_automated_notes(req.manager_notes)
    if (
        not has_tag(tags, TAG_AUTO_MAIL)
        and not meta
        and not req.source_gmail_message_id
        and not notes_auto
    ):
        return None
    return {
        "fromEmail": (meta.get("fromEmail") or "").strip(),
        "subject": (meta.get("subject") or "").strip(),
        "inboxEmail": (meta.get("inboxEmail") or "").strip(),
        "receivedAt": meta.get("receivedAt") or req.received_at,
        "details": ((meta.get("details") or "").strip() or notes_auto or ""),
    }


def _history_sort_key(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.min
    return datetime.min


def _build_directory_request_history(
    _db: Optional[Session],
    rows: List[models.ManagerRequest],
) -> List[Dict[str, Any]]:
    """Timeline of manager submissions, auto-mail receipts, and handled outcomes.

    For each row the function:
    1. Emits any frozen lifecycle events stored in intake_persons["history"]
       (written before a row is mutated, e.g. Add → Remove via Case D).
    2. Derives live events from the current row fields (manager_request /
       auto_mail / handled), skipping any already covered by step 1.
    """
    from app.intake_persons import get_lifecycle_history

    events: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for req in rows:
        # ── Step 1: emit frozen history events ─────────────────────────────────
        stored_events = get_lifecycle_history(req)
        stored_ids_for_req: set[str] = set()
        for stored_event in stored_events:
            event_req_id = stored_event.get("requestId")
            if event_req_id and event_req_id != req.id:
                # Exclude legacy snapshot events belonging to discarded/consumed member requests
                continue
            eid = stored_event.get("id")
            if eid and eid not in seen:
                seen.add(eid)
                stored_ids_for_req.add(eid)
                events.append(stored_event)


        # If we stored suffixed handled variants ("-handled-add" / "-handled-remove")
        # for this row, the bare live-derivation ID would produce a duplicate
        # "Marked as …" entry — block it pre-emptively.
        bare_handled_id = f"{req.id}-handled"
        if (
            f"{req.id}-handled-add" in stored_ids_for_req
            or f"{req.id}-handled-remove" in stored_ids_for_req
        ):
            seen.add(bare_handled_id)

        # ── Step 2: derive live events ──────────────────────────────────────────
        tags = req.tags or []
        manager_user = getattr(req, "_manager_user", None)
        admin_user = getattr(req, "_admin_user", None)
        manager_name = resolve_manager_name(req, manager_user=manager_user)
        handled_by = resolve_handled_by_name(req, admin_user=admin_user)
        display_id = parse_request_display_number(req.id)
        action = req.action or ""
        action_verb = "add" if action == "Add" else "remove" if action == "Remove" else action.lower()

        auto = _light_auto_mail_snapshot(req)

        if auto is not None:
            event_id = f"{req.id}-auto-mail"
            if event_id not in seen:
                seen.add(event_id)
                subject = (auto.get("subject") or "").strip()
                from_email = (auto.get("fromEmail") or "").strip()
                inbox_email = (auto.get("inboxEmail") or "").strip()
                detail_bits = []
                if from_email:
                    detail_bits.append(f"From {from_email}")
                if subject:
                    detail_bits.append(subject)
                events.append(
                    {
                        "id": event_id,
                        "type": "auto_mail",
                        "at": auto.get("receivedAt") or req.received_at,
                        "requestId": req.id,
                        "displayId": display_id,
                        "action": action,
                        "title": f"Automated email received for {action_verb or 'update'}",
                        "detail": " · ".join(detail_bits) if detail_bits else None,
                        "fromEmail": from_email or None,
                        "subject": subject or None,
                        "inboxEmail": inbox_email or None,
                    }
                )

        has_manager = (
            has_tag(tags, TAG_PARTNER_REQUEST)
            or has_tag(tags, TAG_VERIFIED)
            or bool(req.manager_id)
        )
        if has_manager:
            event_id = f"{req.id}-manager-request"
            if event_id not in seen:
                seen.add(event_id)
                is_admin_entry = not req.manager_id and has_tag(tags, TAG_PARTNER_REQUEST)
                who = manager_name or ("an admin" if is_admin_entry else "a manager")
                title_prefix = "Admin entry" if is_admin_entry else "Manager requested"
                events.append(
                    {
                        "id": event_id,
                        "type": "manager_request",
                        "at": req.received_at,
                        "requestId": req.id,
                        "displayId": display_id,
                        "action": action,
                        "title": f"{title_prefix} to {action_verb or 'update'}",
                        "detail": f"Submitted by {manager_name}" if manager_name else f"Submitted by {who}",
                        "managerName": manager_name or ("Admin" if is_admin_entry else None),
                    }
                )

        if req.status == "handled" and req.handled_at:
            event_id = f"{req.id}-handled"
            if event_id not in seen:
                seen.add(event_id)
                outcome = req.outcome or action
                
                if outcome == "Added":
                    title_text = "Added and moved to active"
                elif outcome == "Removed":
                    title_text = "Removed to archive"
                else:
                    title_text = f"Marked as {outcome}"
                    
                events.append(
                    {
                        "id": event_id,
                        "type": "handled",
                        "at": req.handled_at,
                        "requestId": req.id,
                        "displayId": display_id,
                        "action": action,
                        "title": title_text,
                        "detail": f"By {handled_by}" if handled_by else None,
                        "handledBy": handled_by or None,
                        "outcome": outcome,
                    }
                )

    events.sort(key=lambda e: _history_sort_key(e.get("at")), reverse=True)
    return events


def manager_request_list_item_to_api_dict(
    req: models.ManagerRequest,
    *,
    seen_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    from app.intake_persons import get_director_fields
    director = get_director_fields(req)
    return {
        "id": req.id,
        "displayId": parse_request_display_number(req.id),
        "receivedAt": req.received_at,
        "handledAt": req.handled_at,
        "person": {
            "firstName": req.person_first_name,
            "lastName": req.person_last_name,
            "email": req.person_email,
            "location": req.person_location,
            "role": getattr(req, "role", None),
            "directorFirst": director["firstName"] or None,
            "directorLast": director["lastName"] or None,
        },
        "directorFirst": director["firstName"] or None,
        "directorLast": director["lastName"] or None,
        "role": getattr(req, "role", None),
        "action": req.action,
        "status": req.status,
        "outcome": req.outcome,
        "notes": _split_manager_and_automated_notes(req.manager_notes)[0],
        "isUnread": is_request_unread(req, seen_at),
        "partnerId": getattr(req, "partner_id", None),
    }


def manager_requests_list_to_api_dicts(
    requests: List[models.ManagerRequest],
    *,
    seen_map: Optional[Dict[str, datetime]] = None,
) -> List[Dict[str, Any]]:
    seen_map = seen_map or {}
    return [
        manager_request_list_item_to_api_dict(req, seen_at=seen_map.get(req.id))
        for req in requests
    ]


def directory_rows_to_api_dicts(db: Session, rows: List[models.ManagerRequest]) -> List[Dict[str, Any]]:
    from collections import defaultdict

    from sqlalchemy import func

    items = list(rows)
    hydrate_request_users(db, items)

    emails = {
        (row.person_email or "").strip().lower()
        for row in items
        if (row.person_email or "").strip()
    }
    related_by_email: Dict[str, List[models.ManagerRequest]] = defaultdict(list)
    if emails:
        related = (
            db.query(models.ManagerRequest)
            .filter(func.lower(models.ManagerRequest.person_email).in_(list(emails)))
            .order_by(models.ManagerRequest.received_at.desc().nullslast())
            .limit(max(200, len(emails) * 12))
            .all()
        )
        hydrate_request_users(db, related)
        for row in related:
            key = (row.person_email or "").strip().lower()
            if key:
                related_by_email[key].append(row)

    directory_ids = [req.id for req in items]
    group_by_directory_id: Dict[str, models.DuplicateGroup] = {}
    if directory_ids:
        groups = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.directory_person_id.in_(directory_ids))
            .all()
        )
        group_by_directory_id = {
            g.directory_person_id: g for g in groups if g.directory_person_id
        }

    return [
        directory_person_to_api_dict(
            req,
            db=db,
            related_rows=related_by_email.get(
                (req.person_email or "").strip().lower(),
                [req],
            ),
            group_by_directory_id=group_by_directory_id,
        )
        for req in items
    ]
