from typing import List, Optional
from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Header, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, case, func

from app import models
from app import schemas
from app.api.auth import AuthenticatedUser, require_admin, require_manager, auth_is_required
from app.api.rate_limit import rate_limit, prune_old_rate_limit_buckets
from app.api.cron_auth import require_cron_secret
from app.input_validation import normalize_search_query
from app.api.dependencies import get_db
from app.request_display import (
    allocate_request_ids,
    hydrate_request_display,
    request_id_numeric_desc,
)
from app.user_display import hydrate_request_users
from app.manager_request_serialize import (
    directory_rows_to_api_dicts,
    manager_requests_list_to_api_dicts,
    request_to_api_dict,
    requests_to_api_dicts,
)
from app.manager_request_intake import create_handled_manual_request, intake_manager_submission, manager_id_for_email
from app.manager_request_activity import list_partner_activity
from app.manager_request_views import (
    mark_all_handled_seen,
    mark_request_seen,
)
from app.manager_submission_jobs import (
    enqueue_manager_batch,
    get_manager_submission_job,
    process_manager_submission_job_by_id,
    process_pending_manager_submission_jobs,
)
from app.manager_request_summary_cache import (
    get_manager_request_summary,
    invalidate_manager_request_summary,
    set_manager_request_summary,
)
from app.manager_request_stats import (
    decrement_manager_pending_stat,
    increment_manager_request_stats,
)
from app.partner_requests_realtime import notify_admin_requests_changed
from app.dashboard_insights import build_dashboard_insights
from app.partner_allowlists import (
    assert_manager_email_allowed,
    create_automated_source,
    create_partner,
    create_manager_domain,
    delete_automated_source,
    delete_manager_domain,
    delete_partner,
    get_partner_or_404,
    list_automated_sources,
    list_partners,
    list_manager_domain_strings,
    list_manager_domains,
    normalize_manager_domain,
    resolve_partner_for_manager_email,
    update_partner_name,
)
from app.pilot2.ignore_list import parse_ignore_pattern
from app.manager_request_tags import (
    TAG_ALREADY_EXISTS,
    TAG_AUTO_MAIL,
    TAG_UNVERIFIED,
    TAG_VERIFIED,
)
from app.directory_person_match import (
    archived_snapshot_rows,
    directory_ledger_rows,
    find_roster_person,
    roster_match_candidates,
    removed_snapshot_rows,
    roster_snapshot_rows,
    search_roster_rows,
)
from app.duplicate_group_service import (
    _clear_duplicate_tags,
    collect_selective_dismiss_targets,
    compute_group_classification_summary,
    finalize_group_after_selective_dismiss,
    get_active_groups,
    get_dismiss_impact,
    get_group_members,
    permanently_delete_requests,
)
from app.partner_logo_storage import (
    delete_partner_logo,
    migrate_inline_logo_to_storage,
    resolve_partner_logo,
    storage_enabled,
    upload_partner_logo_from_data_url,
)

router = APIRouter()

_limit_submit = rate_limit("manager_submit", max_requests=20, window_seconds=3600, user_dep=require_manager)
_limit_duplicate = rate_limit("manager_duplicate", max_requests=120, window_seconds=60, user_dep=require_manager)
_limit_search = rate_limit("manager_search", max_requests=60, window_seconds=60, user_dep=require_manager)
_limit_match = rate_limit("manager_match", max_requests=120, window_seconds=60, user_dep=require_manager)
# One directory snapshot per page visit — generous so managers never see throttle errors.
_limit_directory = rate_limit("manager_directory", max_requests=30, window_seconds=60, user_dep=require_manager)
# Full history list only (summary is cached server-side and not rate-limited).
_limit_requests_list = rate_limit("manager_requests_list", max_requests=60, window_seconds=60, user_dep=require_manager)

_REASON_RANK = {
    "Email": 6,
    "Name + location": 5,
    "Name": 4,
    "Email + location": 3,
    "First name + location": 2,
    "Last name + location": 1,
}


def _handled_directory_query(db: Session):
    from app.directory_person_match import DIRECTORY_LEDGER_OUTCOMES
    return db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome.in_(DIRECTORY_LEDGER_OUTCOMES),
    )


def _person_search_row(row: models.ManagerRequest) -> dict:
    return {
        "id": row.id,
        "firstName": row.person_first_name,
        "lastName": row.person_last_name,
        "email": row.person_email,
        "location": row.person_location,
        "status": row.outcome,
        "dateAdded": row.handled_at,
        "partnerId": getattr(row, "partner_id", None),
    }


def _duplicate_response(row: models.ManagerRequest) -> dict:
    return {
        "duplicate": True,
        "id": row.id,
        "firstName": row.person_first_name,
        "lastName": row.person_last_name,
        "email": row.person_email,
        "status": row.outcome,
        "dateAdded": row.handled_at,
        "location": row.person_location,
        "partnerId": getattr(row, "partner_id", None),
    }


def _no_duplicate_response() -> dict:
    return {
        "duplicate": False,
        "id": None,
        "firstName": None,
        "lastName": None,
        "email": None,
        "status": None,
        "dateAdded": None,
        "location": None,
        "partnerId": None,
    }


def _find_duplicate_person(
    db: Session,
    *,
    email: str,
    first_name: str,
    last_name: str,
    location: str,
    partner_id: Optional[str] = None,
) -> models.ManagerRequest | None:
    probe = schemas.PersonInfo(
        firstName=first_name,
        lastName=last_name,
        email=email,
        location=location,
    )
    return find_roster_person(db, probe, partner_id=partner_id)


def _find_related_people(
    db: Session,
    *,
    email: str,
    first_name: str,
    last_name: str,
    location: str,
    partner_id: Optional[str] = None,
) -> list[tuple[models.ManagerRequest, set[str]]]:
    probe = schemas.PersonInfo(
        firstName=first_name,
        lastName=last_name,
        email=email,
        location=location,
    )
    return [(row, {"Match"}) for row in roster_match_candidates(db, probe, partner_id=partner_id)]


def _related_person_candidates(
    db: Session,
    *,
    email: str,
    first_name: str,
    last_name: str,
    location: str,
    partner_id: Optional[str] = None,
    limit: int = 10,
) -> list[dict]:
    related = _find_related_people(
        db,
        email=email,
        first_name=first_name,
        last_name=last_name,
        location=location,
        partner_id=partner_id,
    )
    rows = []
    for person, reasons in related[:limit]:
        row = _person_search_row(person)
        row["matchReasons"] = sorted(reasons, key=lambda r: -_REASON_RANK.get(r, 0))
        rows.append(row)
    return rows


def _form_has_match_criteria(email: str, first_name: str, last_name: str, location: str) -> bool:
    if email:
        return True
    if first_name and last_name:
        return True
    if location and (first_name or last_name):
        return True
    return False


def _search_people(
    db: Session,
    query: str,
    *,
    limit: int,
    partner_id: Optional[str] = None,
) -> list[models.ManagerRequest]:
    return search_roster_rows(db, query, limit=limit, partner_id=partner_id)


def _manager_partner_id(
    db: Session,
    manager_email: str,
    partner_id: Optional[str] = None,
    manager_user_id: Optional[str] = None,
    header_partner_id: Optional[str] = None,
    header_partner_slug: Optional[str] = None,
) -> str:
    effective_partner_id = partner_id or header_partner_id
    effective_partner_slug = header_partner_slug
    resolved_id = resolve_partner_for_manager_email(
        db,
        manager_email,
        partner_id=effective_partner_id,
        partner_slug=effective_partner_slug,
        manager_user_id=manager_user_id,
    )
    if not resolved_id:
        raise HTTPException(status_code=409, detail="Manager account is not assigned to a partner.")
    return resolved_id

@router.get("/api/requests", response_model=List[schemas.RequestOut])
def get_requests(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    db_requests = (
        db.query(models.ManagerRequest)
        .order_by(request_id_numeric_desc())
        .all()
    )
    hydrate_request_display(db_requests)
    return requests_to_api_dicts(db, db_requests)

@router.get("/api/persons", response_model=List[schemas.PersonOut])
def get_people(
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    if partner_id:
        get_partner_or_404(db, partner_id)
    rows = directory_ledger_rows(db, limit=2000, partner_id=partner_id)
    return directory_rows_to_api_dicts(db, rows)


@router.patch("/api/persons/{person_id}", response_model=schemas.PersonOut)
def update_person(
    person_id: str,
    payload: schemas.PersonUpdateIn,
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == person_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Directory record not found")

    if partner_id:
        get_partner_or_404(db, partner_id)
        if req.partner_id and req.partner_id != partner_id:
            raise HTTPException(status_code=404, detail="Directory record not found for partner")

    req.person_first_name = payload.firstName
    req.person_last_name = payload.lastName
    req.person_email = payload.email
    req.person_location = (payload.location or "").strip()
    if hasattr(payload, "role"):
        req.role = payload.role or None
    if getattr(payload, "directorFirst", None) is not None or getattr(payload, "directorLast", None) is not None:
        from app.intake_persons import set_director_fields
        set_director_fields(
            req,
            getattr(payload, "directorFirst", None) or "",
            getattr(payload, "directorLast", None) or "",
        )

    if req.intake_persons and isinstance(req.intake_persons, dict):
        updated_dict = dict(req.intake_persons)
        new_snapshot = {
            "firstName": payload.firstName,
            "lastName": payload.lastName,
            "email": payload.email,
            "location": (payload.location or "").strip(),
            "role": payload.role or None,
        }
        for key in ("partner", "autoMail", "admin"):
            if key in updated_dict and isinstance(updated_dict[key], dict):
                updated_dict[key] = {**updated_dict[key], **new_snapshot}
        req.intake_persons = updated_dict

    db.commit()
    db.refresh(req)
    return directory_rows_to_api_dicts(db, [req])[0]


@router.get("/api/persons/archived", response_model=List[schemas.PersonOut])
def get_archived_people(
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    if partner_id:
        get_partner_or_404(db, partner_id)
    rows = archived_snapshot_rows(db, limit=2000, partner_id=partner_id)
    return directory_rows_to_api_dicts(db, rows)


@router.post("/api/persons/{person_id}/archive", response_model=schemas.PersonOut)
def archive_person(
    person_id: str,
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == person_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Directory record not found")

    if partner_id:
        get_partner_or_404(db, partner_id)
        if req.partner_id and req.partner_id != partner_id:
            raise HTTPException(status_code=404, detail="Directory record not found for partner")

    now = datetime.now(timezone.utc)
    req.archived_at = now
    
    admin_name = "Power Music Admin"
    if hasattr(_admin, "id") and _admin.id != "dev-bypass":
        try:
            from uuid import UUID
            admin_user = db.query(models.PowermusicUser).filter(models.PowermusicUser.id == UUID(_admin.id)).first()
            if admin_user:
                admin_name = f"{admin_user.first_name} {admin_user.last_name}".strip() or admin_name
        except Exception:
            pass

    from app.intake_persons import append_lifecycle_history
    from app.request_display import parse_request_display_number
    archive_event_id = f"{req.id}-archive-{now.timestamp()}"
    append_lifecycle_history(req, [{
        "id": archive_event_id,
        "type": "handled",
        "at": now.isoformat(),
        "requestId": req.id,
        "displayId": parse_request_display_number(req.id),
        "action": "Remove",
        "title": "Moved to archive",
        "detail": f"By {admin_name}",
        "handledBy": admin_name,
        "outcome": "Removed",
    }])

    db.commit()
    db.refresh(req)
    return directory_rows_to_api_dicts(db, [req])[0]


@router.post("/api/persons/bulk-archive", response_model=List[schemas.PersonOut])
def bulk_archive_persons(
    payload: schemas.BulkActionPayload,
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    if not payload.ids:
        return []

    if partner_id:
        get_partner_or_404(db, partner_id)

    reqs = db.query(models.ManagerRequest).filter(models.ManagerRequest.id.in_(payload.ids)).all()
    
    if partner_id:
        reqs = [r for r in reqs if not r.partner_id or r.partner_id == partner_id]

    now = datetime.now(timezone.utc)
    
    admin_name = "Power Music Admin"
    if hasattr(_admin, "id") and _admin.id != "dev-bypass":
        try:
            from uuid import UUID
            admin_user = db.query(models.PowermusicUser).filter(models.PowermusicUser.id == UUID(_admin.id)).first()
            if admin_user:
                admin_name = f"{admin_user.first_name} {admin_user.last_name}".strip() or admin_name
        except Exception:
            pass

    from app.intake_persons import append_lifecycle_history
    from app.request_display import parse_request_display_number

    for req in reqs:
        req.archived_at = now
        archive_event_id = f"{req.id}-archive-{now.timestamp()}"
        append_lifecycle_history(req, [{
            "id": archive_event_id,
            "type": "handled",
            "at": now.isoformat(),
            "requestId": req.id,
            "displayId": parse_request_display_number(req.id),
            "action": "Remove",
            "title": "Moved to archive",
            "detail": f"By {admin_name}",
            "handledBy": admin_name,
            "outcome": "Removed",
        }])

    db.commit()
    for req in reqs:
        db.refresh(req)

    return directory_rows_to_api_dicts(db, reqs)


@router.post("/api/persons/{person_id}/restore", response_model=schemas.PersonOut)
def restore_person(
    person_id: str,
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == person_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Directory record not found")

    if partner_id:
        get_partner_or_404(db, partner_id)
        if req.partner_id and req.partner_id != partner_id:
            raise HTTPException(status_code=404, detail="Directory record not found for partner")

    now = datetime.now(timezone.utc)
    req.archived_at = None
    
    admin_name = "Power Music Admin"
    if hasattr(_admin, "id") and _admin.id != "dev-bypass":
        try:
            from uuid import UUID
            admin_user = db.query(models.PowermusicUser).filter(models.PowermusicUser.id == UUID(_admin.id)).first()
            if admin_user:
                admin_name = f"{admin_user.first_name} {admin_user.last_name}".strip() or admin_name
        except Exception:
            pass

    from app.intake_persons import append_lifecycle_history
    from app.request_display import parse_request_display_number
    restore_event_id = f"{req.id}-restore-{now.timestamp()}"
    append_lifecycle_history(req, [{
        "id": restore_event_id,
        "type": "handled",
        "at": now.isoformat(),
        "requestId": req.id,
        "displayId": parse_request_display_number(req.id),
        "action": "Add",
        "title": "Restored to active",
        "detail": f"By {admin_name}",
        "handledBy": admin_name,
        "outcome": "Added",
    }])

    db.commit()
    db.refresh(req)
    return directory_rows_to_api_dicts(db, [req])[0]


@router.post("/api/persons/bulk-restore", response_model=List[schemas.PersonOut])
def bulk_restore_persons(
    payload: schemas.BulkActionPayload,
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    if partner_id:
        get_partner_or_404(db, partner_id)

    if not payload.ids:
        return []

    reqs = db.query(models.ManagerRequest).filter(models.ManagerRequest.id.in_(payload.ids)).all()
    
    now = datetime.now(timezone.utc)

    admin_name = "Power Music Admin"
    if _admin and _admin.id and _admin.id != "dev-bypass":
        try:
            from uuid import UUID
            admin_user = db.query(models.PowermusicUser).filter(models.PowermusicUser.id == UUID(_admin.id)).first()
            if admin_user:
                admin_name = f"{admin_user.first_name} {admin_user.last_name}".strip() or admin_name
        except Exception:
            pass

    from app.intake_persons import append_lifecycle_history
    from app.request_display import parse_request_display_number

    for req in reqs:
        if partner_id and req.partner_id and req.partner_id != partner_id:
            continue
        req.archived_at = None
        restore_event_id = f"{req.id}-restore-{now.timestamp()}"
        append_lifecycle_history(req, [{
            "id": restore_event_id,
            "type": "handled",
            "at": now.isoformat(),
            "requestId": req.id,
            "displayId": parse_request_display_number(req.id),
            "action": "Add",
            "title": "Restored to active",
            "detail": f"By {admin_name}",
            "handledBy": admin_name,
            "outcome": "Added",
        }])

    db.commit()
    for req in reqs:
        db.refresh(req)

    return directory_rows_to_api_dicts(db, reqs)


@router.post("/api/persons/bulk-delete")
def bulk_delete_persons(
    payload: schemas.BulkActionPayload,
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    from app.duplicate_group_service import permanently_delete_requests

    if partner_id:
        get_partner_or_404(db, partner_id)

    if not payload.ids:
        return {"success": True, "deleted_count": 0}

    reqs = db.query(models.ManagerRequest).filter(models.ManagerRequest.id.in_(payload.ids)).all()

    if partner_id:
        reqs = [r for r in reqs if not r.partner_id or r.partner_id == partner_id]

    valid_ids = [r.id for r in reqs]
    if not valid_ids:
        return {"success": True, "deleted_count": 0}

    deleted_count = permanently_delete_requests(db, valid_ids)
    db.commit()

    return {"success": True, "deleted_count": deleted_count}


def _visible_new_requests_query(db: Session, partner_id: Optional[str] = None):
    from sqlalchemy import select
    rep_subquery = select(models.DuplicateGroup.representative_request_id).where(
        models.DuplicateGroup.status == "active",
        models.DuplicateGroup.representative_request_id.isnot(None),
    )
    query = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.status == "new",
            or_(
                models.ManagerRequest.duplicate_group_id.is_(None),
                models.ManagerRequest.id.in_(rep_subquery),
            ),
            or_(
                models.ManagerRequest.tags.contains([TAG_VERIFIED]),
                and_(
                    models.ManagerRequest.tags.contains([TAG_UNVERIFIED]),
                    models.ManagerRequest.tags.contains([TAG_AUTO_MAIL]),
                ),
            ),
        )
    )
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    return query


@router.get("/api/kpis", response_model=schemas.KpiOut)
def get_kpis(partner_id: Optional[str] = None, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    pending = _visible_new_requests_query(db, partner_id=partner_id).count()
    users = len(directory_ledger_rows(db, limit=10_000, partner_id=partner_id))
    return {"pendingRequests": pending, "usersInLedger": users}


@router.get("/api/dashboard", response_model=schemas.DashboardOut)
def get_dashboard(
    partner_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin)
):
    pending = (
        _visible_new_requests_query(db, partner_id=partner_id)
        .order_by(request_id_numeric_desc())
        .all()
    )
    hydrate_request_display(pending)
    pending_payloads = requests_to_api_dicts(db, pending)
    insights = build_dashboard_insights(db, pending=pending, pending_payloads=pending_payloads, partner_id=partner_id, start_date=start_date, end_date=end_date)
    return {
        "kpis": {
            "pendingRequests": len(pending),
            "usersInLedger": insights["usersInLedger"],
        },
        "pendingRequests": pending_payloads,
        "activity": list_partner_activity(db, limit=8, partner_id=partner_id),
        "insights": insights,
    }

@router.get("/api/activity", response_model=List[schemas.ActivityOut])
def get_activity(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    return list_partner_activity(db, limit=10)


def _assert_manager_submitter(
    submitted_by: schemas.SubmittedBy,
    manager,
    db: Session,
    partner_id: Optional[str] = None,
    header_partner_id: Optional[str] = None,
    header_partner_slug: Optional[str] = None,
) -> str:
    sub_email = (submitted_by.email or "").strip()
    effective_partner_id = partner_id or header_partner_id
    effective_partner_slug = header_partner_slug
    resolved_partner_id = resolve_partner_for_manager_email(
        db,
        sub_email or manager.email,
        partner_id=effective_partner_id,
        partner_slug=effective_partner_slug,
        manager_user_id=manager.id if manager else None,
    )
    if not resolved_partner_id:
        raise HTTPException(status_code=409, detail="Manager account is not assigned to a partner.")

    partner = get_partner_or_404(db, resolved_partner_id)
    is_health_fitness = (partner.name or "").strip().lower() == "health fitness"

    if auth_is_required() and not is_health_fitness:
        if sub_email.lower() != manager.email.lower():
            raise HTTPException(
                status_code=403,
                detail="Submitter email must match your signed-in account.",
            )

    return assert_manager_email_allowed(
        db,
        manager.email if is_health_fitness else (sub_email or manager.email),
        partner_id=resolved_partner_id,
        partner_slug=effective_partner_slug,
        manager_user_id=manager.id if manager else None,
    )


def _manager_id_for_submitter(
    db: Session,
    submitted_by: schemas.SubmittedBy,
    *,
    manager_user_id: Optional[str] = None,
) -> Optional[str]:
    if manager_user_id and manager_user_id != "dev-bypass":
        return manager_user_id
    return manager_id_for_email(db, submitted_by.email or "")


def _create_manager_request_row(
    db: Session,
    *,
    submitted_by: schemas.SubmittedBy,
    person: schemas.PersonInfo,
    action: str,
    notes: Optional[str],
    partner_id: Optional[str] = None,
    new_id: Optional[str] = None,
    manager_user_id: Optional[str] = None,
) -> models.ManagerRequest:
    return intake_manager_submission(
        db,
        person=person,
        action=action,
        manager_notes=notes,
        manager_id=_manager_id_for_submitter(db, submitted_by, manager_user_id=manager_user_id),
        partner_id=partner_id,
        new_id=new_id,
        submitted_by=submitted_by,
    )


@router.post("/api/requests", response_model=schemas.RequestOut)
def create_request(
    req_in: schemas.RequestIn,
    db: Session = Depends(get_db),
    manager=Depends(_limit_submit),
    x_partner_id: Optional[str] = Header(None, alias="X-Partner-Id"),
    x_partner_slug: Optional[str] = Header(None, alias="X-Partner-Slug"),
):
    partner_id = _assert_manager_submitter(
        req_in.submittedBy,
        manager,
        db,
        partner_id=req_in.partnerId,
        header_partner_id=x_partner_id,
        header_partner_slug=x_partner_slug,
    )

    new_request = _create_manager_request_row(
        db,
        submitted_by=req_in.submittedBy,
        person=req_in.person,
        action=req_in.action,
        notes=req_in.notes,
        partner_id=partner_id,
        manager_user_id=manager.id,
    )
    increment_manager_request_stats(db, new_request)
    db.commit()
    db.refresh(new_request)
    hydrate_request_display([new_request])
    hydrate_request_users(db, [new_request])
    invalidate_manager_request_summary(manager.id)
    notify_admin_requests_changed("manager_submit")
    return request_to_api_dict(new_request)


@router.post(
    "/api/requests/batch",
    status_code=202,
    response_model=schemas.ManagerSubmissionJobOut,
)
def create_requests_batch(
    req_in: schemas.ManagerBatchRequestIn,
    db: Session = Depends(get_db),
    manager=Depends(_limit_submit),
    x_partner_id: Optional[str] = Header(None, alias="X-Partner-Id"),
    x_partner_slug: Optional[str] = Header(None, alias="X-Partner-Slug"),
):
    partner_id = _assert_manager_submitter(
        req_in.submittedBy,
        manager,
        db,
        partner_id=req_in.partnerId,
        header_partner_id=x_partner_id,
        header_partner_slug=x_partner_slug,
    )
    req_in = req_in.model_copy(update={"partnerId": partner_id})

    job = enqueue_manager_batch(db, manager_id=manager.id, req_in=req_in)
    invalidate_manager_request_summary(manager.id)
    job = process_manager_submission_job_by_id(db, job.id) or job

    return _submission_job_response(job)


def _submission_job_response(job: models.ManagerSubmissionJob) -> dict:
    result = job.result if isinstance(job.result, dict) else {}
    items = result.get("items") if isinstance(result.get("items"), list) else None
    return {
        "jobId": job.id,
        "status": job.status,
        "count": int(result.get("count") or len(job.payload.get("people") or [])),
        "error": job.error,
        "items": items,
    }


@router.get(
    "/api/manager/submission-jobs/{job_id}",
    response_model=schemas.ManagerSubmissionJobOut,
)
def get_manager_submission_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    manager=Depends(require_manager),
):
    job = get_manager_submission_job(db, job_id=job_id, manager_id=manager.id)
    if job is None:
        raise HTTPException(status_code=404, detail="Submission job not found")
    return _submission_job_response(job)


@router.api_route("/api/jobs/process-manager-submissions", methods=["GET", "POST"])
def process_manager_submission_jobs(
    request: Request,
    secret: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Cron worker — processes queued manager batch submissions."""
    require_cron_secret(request, secret)
    stats = process_pending_manager_submission_jobs(db)
    stats["prunedRateLimitBuckets"] = prune_old_rate_limit_buckets(db)
    return stats

@router.get("/api/admin/requests", response_model=List[schemas.RequestOut])
def get_admin_requests(
    status: Optional[str] = None,
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    if partner_id:
        get_partner_or_404(db, partner_id)
    query = db.query(models.ManagerRequest)
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    if status:
        query = query.filter(models.ManagerRequest.status == status)
    
    if status == "handled":
        db_requests = query.order_by(models.ManagerRequest.handled_at.desc()).all()
    else:
        db_requests = query.order_by(request_id_numeric_desc()).all()

    hydrate_request_display(db_requests)
    return requests_to_api_dicts(db, db_requests)

@router.get("/api/admin/requests/page", response_model=schemas.NewRequestsPageOut)
def get_new_requests_page(
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    if partner_id:
        get_partner_or_404(db, partner_id)
    query = _visible_new_requests_query(db)
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    db_requests = query.order_by(request_id_numeric_desc()).all()
    hydrate_request_display(db_requests)
    directory = directory_ledger_rows(db, limit=2000, partner_id=partner_id)
    return {
        "requests": requests_to_api_dicts(db, db_requests),
        "persons": directory_rows_to_api_dicts(db, directory),
    }

@router.post("/api/admin/requests/{request_id}/mark-handled", response_model=schemas.RequestOut)
def mark_request_handled(
    request_id: str,
    payload: schemas.MarkHandledIn = schemas.MarkHandledIn(),
    db: Session = Depends(get_db),
    admin: AuthenticatedUser = Depends(require_admin),
):
    req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
        
    if req.status == "handled":
        hydrate_request_users(db, [req])
        return request_to_api_dict(req)
        
    outcome = "Added" if req.action == "Add" else "Removed"
    was_new = req.status == "new"

    req.status = "handled"
    now_ts = datetime.now(timezone.utc)
    req.handled_at = now_ts
    req.outcome = outcome
    if outcome == "Removed":
        req.archived_at = now_ts
    else:
        req.archived_at = None
    if admin.id != "dev-bypass":
        req.handled_by_admin_id = admin.id
    if payload.adminNote:
        req.admin_notes = payload.adminNote
        
    if payload.finalValues:
        req.person_first_name = (payload.finalValues.firstName or "").strip()
        req.person_last_name = (payload.finalValues.lastName or "").strip()
        req.person_email = (payload.finalValues.email or "").strip()
        req.person_location = (payload.finalValues.location or "").strip()
        if hasattr(payload.finalValues, "role") and payload.finalValues.role is not None:
            req.role = (payload.finalValues.role or "").strip() or None
        if getattr(payload.finalValues, "directorFirst", None) is not None or getattr(payload.finalValues, "directorLast", None) is not None:
            from app.intake_persons import set_director_fields
            set_director_fields(
                req,
                getattr(payload.finalValues, "directorFirst", None) or "",
                getattr(payload.finalValues, "directorLast", None) or "",
            )

    if was_new:
        decrement_manager_pending_stat(db, req)

    db.commit()
    db.refresh(req)
    hydrate_request_display([req])
    hydrate_request_users(db, [req])
    if req.manager_id:
        invalidate_manager_request_summary(str(req.manager_id))
    if was_new:
        notify_admin_requests_changed("mark_handled")
    return request_to_api_dict(req)

@router.get(
    "/api/admin/requests/{request_id}/dismiss-impact",
    response_model=schemas.DismissImpactOut,
)
def request_dismiss_impact(
    request_id: str,
    db: Session = Depends(get_db),
    admin: AuthenticatedUser = Depends(require_admin),
):
    """Preview cascade: confirmed duplicate siblings are deleted with the request; potentials stay."""
    req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return get_dismiss_impact(db, request_id)


@router.post("/api/admin/requests/{request_id}/dismiss", response_model=schemas.RequestOut)
def dismiss_request(
    request_id: str,
    db: Session = Depends(get_db),
    admin: AuthenticatedUser = Depends(require_admin),
):
    req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    hydrate_request_display([req])
    hydrate_request_users(db, [req])
    out_dict = request_to_api_dict(req)

    was_new = req.status == "new"
    group_id = req.duplicate_group_id
    requests_to_dismiss, survivors = collect_selective_dismiss_targets(db, req)

    dismiss_ids = [r.id for r in requests_to_dismiss]
    permanently_delete_requests(db, dismiss_ids)

    if group_id:
        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == group_id)
            .first()
        )
        if group and group.status == "active":
            finalize_group_after_selective_dismiss(
                db,
                group,
                {s.id for s in survivors if s.id not in set(dismiss_ids)},
                admin.id,
            )

    db.commit()
    if was_new:
        notify_admin_requests_changed("dismiss_request")
    return out_dict


@router.post("/api/admin/requests/bulk-dismiss", response_model=List[schemas.RequestOut])
def bulk_dismiss_requests(
    payload: schemas.BulkActionPayload,
    db: Session = Depends(get_db),
    admin: AuthenticatedUser = Depends(require_admin),
):
    if not payload.ids:
        return []

    reqs = db.query(models.ManagerRequest).filter(models.ManagerRequest.id.in_(payload.ids)).all()
    if not reqs:
        return []

    hydrate_request_display(reqs)
    hydrate_request_users(db, reqs)
    out_dicts = requests_to_api_dicts(db, reqs)

    any_was_new = any(r.status == "new" for r in reqs)
    all_dismiss_ids = set()

    for req in reqs:
        if req.id in all_dismiss_ids:
            continue

        group_id = req.duplicate_group_id
        requests_to_dismiss, survivors = collect_selective_dismiss_targets(db, req)
        dismiss_ids = [r.id for r in requests_to_dismiss]
        all_dismiss_ids.update(dismiss_ids)

        if group_id:
            group = (
                db.query(models.DuplicateGroup)
                .filter(models.DuplicateGroup.id == group_id)
                .first()
            )
            if group and group.status == "active":
                finalize_group_after_selective_dismiss(
                    db,
                    group,
                    {s.id for s in survivors if s.id not in all_dismiss_ids},
                    admin.id,
                )

    permanently_delete_requests(db, list(all_dismiss_ids))
    db.commit()
    if any_was_new:
        notify_admin_requests_changed("dismiss_request_bulk")

    return out_dicts



@router.post("/api/admin/requests/manual", response_model=List[schemas.RequestOut])
def create_manual_requests(req_in: schemas.ManualRequestIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    manual_submitter = schemas.SubmittedBy(
        firstName=req_in.submittedBy.firstName,
        lastName=req_in.submittedBy.lastName,
        email=req_in.submittedBy.email,
        club=req_in.submittedBy.club,
    )
    if req_in.action == "Add":
        new_requests = [
            create_handled_manual_request(
                db,
                person=person_in,
                action=req_in.action,
                submitted_by=manual_submitter,
                manager_notes=person_in.notes or req_in.notes,
                admin_id=admin.id,
                partner_id=req_in.partnerId,
            )
            for person_in in req_in.people
        ]
    else:
        # Keep existing pending-request behavior for manual removals.
        new_requests = [
            _create_manager_request_row(
                db,
                submitted_by=manual_submitter,
                person=person_in,
                action=req_in.action,
                notes=person_in.notes or req_in.notes,
                partner_id=req_in.partnerId,
                new_id=None,
            )
            for person_in in req_in.people
        ]

    db.commit()

    for req in new_requests:
        db.refresh(req)
    hydrate_request_display(new_requests)
    if req_in.action != "Add":
        notify_admin_requests_changed("admin_manual")
    return requests_to_api_dicts(db, new_requests)


@router.post("/api/persons/check-duplicate", response_model=schemas.DuplicateCheckOut)
def check_person_duplicate(
    payload: schemas.DuplicateCheckIn,
    partner_id: Optional[str] = None,
    partner_slug: Optional[str] = None,
    db: Session = Depends(get_db),
    manager=Depends(_limit_duplicate),
    x_partner_id: Optional[str] = Header(None, alias="X-Partner-Id"),
    x_partner_slug: Optional[str] = Header(None, alias="X-Partner-Slug"),
):
    """Manager-portal helper — match by email, name, or name + location."""
    resolved_partner_id = _manager_partner_id(
        db,
        manager.email,
        partner_id=payload.partnerId or partner_id,
        manager_user_id=manager.id if manager else None,
        header_partner_id=x_partner_id,
        header_partner_slug=partner_slug or x_partner_slug,
    )
    p_email = (payload.email or "").strip().lower()
    p_first = (payload.firstName or "").strip().lower()
    p_last = (payload.lastName or "").strip().lower()
    p_location = (payload.location or "").strip().lower()

    if not p_email and not (p_first and p_last):
        return _no_duplicate_response()

    match = _find_duplicate_person(
        db,
        email=p_email,
        first_name=p_first,
        last_name=p_last,
        location=p_location,
        partner_id=resolved_partner_id,
    )
    if match:
        return _duplicate_response(match)
    return _no_duplicate_response()


@router.post(
    "/api/manager/persons/match-candidates",
    response_model=List[schemas.PersonMatchCandidateOut],
)
def match_person_candidates(
    payload: schemas.DuplicateCheckIn,
    partner_id: Optional[str] = None,
    partner_slug: Optional[str] = None,
    limit: int = 10,
    db: Session = Depends(get_db),
    manager=Depends(_limit_match),
    x_partner_id: Optional[str] = Header(None, alias="X-Partner-Id"),
    x_partner_slug: Optional[str] = Header(None, alias="X-Partner-Slug"),
):
    """All directory rows that share any person-form field (or field + location)."""
    resolved_partner_id = _manager_partner_id(
        db,
        manager.email,
        partner_id=payload.partnerId or partner_id,
        manager_user_id=manager.id if manager else None,
        header_partner_id=x_partner_id,
        header_partner_slug=partner_slug or x_partner_slug,
    )
    p_email = (payload.email or "").strip().lower()
    p_first = (payload.firstName or "").strip().lower()
    p_last = (payload.lastName or "").strip().lower()
    p_location = (payload.location or "").strip().lower()

    if not _form_has_match_criteria(p_email, p_first, p_last, p_location):
        return []

    capped = min(max(limit, 1), 15)
    return _related_person_candidates(
        db,
        email=p_email,
        first_name=p_first,
        last_name=p_last,
        location=p_location,
        partner_id=resolved_partner_id,
        limit=capped,
    )


def _manager_requests_query(db: Session, manager: AuthenticatedUser):
    query = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.tags.contains([TAG_VERIFIED]),
    )
    if manager.id and manager.id != "dev-bypass":
        try:
            manager_uuid = uuid.UUID(str(manager.id))
        except ValueError:
            return query.filter(models.ManagerRequest.id.is_(None))
        query = query.filter(models.ManagerRequest.manager_id == manager_uuid)
    return query


@router.get("/api/manager/requests/summary", response_model=schemas.ManagerRequestsSummaryOut)
def manager_requests_summary(
    db: Session = Depends(get_db),
    manager: AuthenticatedUser = Depends(require_manager),
):
    """Lightweight counts for the manager portal card."""
    cached = get_manager_request_summary(manager.id)
    if cached is not None:
        return cached

    base = _manager_requests_query(db, manager)
    total, pending_count = base.with_entities(
        func.count(),
        func.sum(case((models.ManagerRequest.status == "new", 1), else_=0)),
    ).one()
    payload = {
        "total": int(total or 0),
        "pendingCount": int(pending_count or 0),
    }
    set_manager_request_summary(
        manager.id,
        total=payload["total"],
        pending_count=payload["pendingCount"],
    )
    return payload


@router.get("/api/manager/requests", response_model=schemas.ManagerRequestsPageOut)
def list_manager_requests(
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: Session = Depends(get_db),
    manager: AuthenticatedUser = Depends(_limit_requests_list),
):
    """Paginated requests submitted by the signed-in manager (portal submissions only)."""
    if status and status not in ("new", "handled"):
        raise HTTPException(status_code=400, detail="status must be new or handled")

    safe_page = max(page, 1)
    safe_limit = min(max(limit, 1), 50)
    offset = (safe_page - 1) * safe_limit

    query = _manager_requests_query(db, manager)
    if status:
        query = query.filter(models.ManagerRequest.status == status)

    base = _manager_requests_query(db, manager)
    if status:
        total = query.count()
        pending_count = (
            total if status == "new" else base.filter(models.ManagerRequest.status == "new").count()
        )
    else:
        total, pending_count = base.with_entities(
            func.count(),
            func.sum(case((models.ManagerRequest.status == "new", 1), else_=0)),
        ).one()
        total = int(total or 0)
        pending_count = int(pending_count or 0)

    if status == "handled":
        rows = (
            query.order_by(models.ManagerRequest.handled_at.desc())
            .offset(offset)
            .limit(safe_limit)
            .all()
        )
    else:
        rows = query.order_by(request_id_numeric_desc()).offset(offset).limit(safe_limit).all()

    hydrate_request_display(rows)
    return {
        "items": manager_requests_list_to_api_dicts(rows),
        "total": total,
        "page": safe_page,
        "limit": safe_limit,
        "unreadCount": 0,
        "pendingCount": pending_count,
    }


@router.post("/api/manager/requests/{request_id}/mark-seen")
def mark_manager_request_seen(
    request_id: str,
    db: Session = Depends(get_db),
    manager: AuthenticatedUser = Depends(_limit_requests_list),
):
    """Mark a handled request as seen by the signed-in manager."""
    req = (
        _manager_requests_query(db, manager)
        .filter(models.ManagerRequest.id == request_id)
        .first()
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "handled":
        return {"ok": True, "marked": 0}

    mark_request_seen(db, manager_id=manager.id, request_id=request_id)
    db.commit()
    return {"ok": True, "marked": 1}


@router.post("/api/manager/requests/mark-all-seen")
def mark_all_manager_requests_seen(
    db: Session = Depends(get_db),
    manager: AuthenticatedUser = Depends(_limit_requests_list),
):
    """Mark all handled requests as seen for the signed-in manager."""
    marked = mark_all_handled_seen(
        db,
        manager_id=manager.id,
        base_query=_manager_requests_query(db, manager),
    )
    db.commit()
    return {"ok": True, "marked": marked}


@router.get("/api/manager/persons/directory", response_model=List[schemas.PersonSearchOut])
def manager_person_directory(
    outcome: str = "Added",
    partner_id: Optional[str] = None,
    partner_slug: Optional[str] = None,
    db: Session = Depends(get_db),
    manager=Depends(_limit_directory),
    x_partner_id: Optional[str] = Header(None, alias="X-Partner-Id"),
    x_partner_slug: Optional[str] = Header(None, alias="X-Partner-Slug"),
):
    """Roster snapshot for instant client-side search (load in background)."""
    resolved_partner_id = _manager_partner_id(
        db,
        manager.email,
        partner_id=partner_id,
        manager_user_id=manager.id if manager else None,
        header_partner_id=x_partner_id,
        header_partner_slug=partner_slug or x_partner_slug,
    )
    if outcome not in {"Added", "Removed"}:
        raise HTTPException(status_code=422, detail="outcome must be Added or Removed")
    if outcome == "Removed":
        rows = removed_snapshot_rows(db, limit=1000, partner_id=resolved_partner_id)
    else:
        rows = roster_snapshot_rows(db, limit=1000, partner_id=resolved_partner_id)
    return [_person_search_row(row) for row in rows]


@router.get("/api/manager/persons/search", response_model=List[schemas.PersonSearchOut])
def search_persons_for_manager(
    q: str = "",
    partner_id: Optional[str] = None,
    partner_slug: Optional[str] = None,
    limit: int = 25,
    db: Session = Depends(get_db),
    manager=Depends(_limit_search),
    x_partner_id: Optional[str] = Header(None, alias="X-Partner-Id"),
    x_partner_slug: Optional[str] = Header(None, alias="X-Partner-Slug"),
):
    """Scoped search for the manager submit form — name, email, or location."""
    resolved_partner_id = _manager_partner_id(
        db,
        manager.email,
        partner_id=partner_id,
        manager_user_id=manager.id if manager else None,
        header_partner_id=x_partner_id,
        header_partner_slug=partner_slug or x_partner_slug,
    )
    try:
        query = normalize_search_query(q, max_length=100).lower()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if len(query) < 2:
        return []

    capped = min(max(limit, 1), 25)
    people = _search_people(db, query, limit=capped, partner_id=resolved_partner_id)
    return [_person_search_row(person) for person in people]


# ── Partner allowlists (manager domains + automated roster sources) ──


@router.get("/api/manager/allowed-domains", response_model=schemas.ManagerAllowedDomainsPublicOut)
def public_manager_allowed_domains(db: Session = Depends(get_db)):
    """Public list used by the manager signup / login UI."""
    return {"domains": list_manager_domain_strings(db)}


@router.get("/api/public/partner-branding")
def public_partner_branding(
    email: str = "",
    partner_id: Optional[str] = None,
    partner_slug: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Resolve partner name/logo from a manager email domain (sign-in page branding)."""
    addr = (email or "").strip().lower()
    if not addr or "@" not in addr:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    resolved_partner_id = resolve_partner_for_manager_email(
        db,
        addr,
        partner_id=partner_id,
        partner_slug=partner_slug,
    )
    if not resolved_partner_id:
        raise HTTPException(status_code=404, detail="No partner found for this email domain.")
    partner = get_partner_or_404(db, resolved_partner_id)
    form = (
        db.query(models.PartnerCustomForm)
        .filter(models.PartnerCustomForm.partner_id == resolved_partner_id)
        .first()
    )
    if form:
        migrate_inline_logo_to_storage(db, form)
    logo = resolve_partner_logo(form)
    return {
        "partnerId": partner.id,
        "partnerName": partner.name,
        "logoUrl": logo,
        "logoDataUrl": logo,
    }


@router.get("/api/admin/manager-domains", response_model=List[schemas.ManagerAllowedDomainOut])
def admin_list_manager_domains(
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
    partner_id: Optional[str] = None,
):
    if partner_id:
        get_partner_or_404(db, partner_id)
    return list_manager_domains(db, partner_id=partner_id)


@router.post("/api/admin/manager-domains", response_model=schemas.ManagerAllowedDomainOut)
def admin_create_manager_domain(
    payload: schemas.ManagerAllowedDomainCreateIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    partner_id = (payload.partnerId or "").strip()
    if not partner_id:
        raise HTTPException(status_code=400, detail="partnerId is required")
    return create_manager_domain(db, payload.domain, partner_id)


@router.delete("/api/admin/manager-domains/{domain_id}")
def admin_delete_manager_domain(
    domain_id: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    return {"deleted": delete_manager_domain(db, domain_id)}


@router.get("/api/admin/automated-sources", response_model=List[schemas.AutomatedRosterSourceOut])
def admin_list_automated_sources(
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
    partner_id: Optional[str] = None,
):
    if partner_id:
        get_partner_or_404(db, partner_id)
    return list_automated_sources(db, partner_id=partner_id)


@router.post("/api/admin/automated-sources", response_model=schemas.AutomatedRosterSourceOut)
def admin_create_automated_source(
    payload: schemas.AutomatedRosterSourceCreateIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    partner_id = (payload.partnerId or "").strip()
    if not partner_id:
        raise HTTPException(status_code=400, detail="partnerId is required")
    return create_automated_source(db, payload.pattern, partner_id)


@router.get("/api/partners", response_model=List[schemas.PartnerOut])
def list_partners_api(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    return list_partners(db)


@router.post("/api/partners", response_model=schemas.PartnerOut)
def create_partner_api(
    payload: schemas.PartnerCreateIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    for domain in dict.fromkeys(payload.allowedDomains):
        try:
            normalize_manager_domain(domain)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    for source in dict.fromkeys(payload.automatedSources):
        try:
            parse_ignore_pattern(source)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    partner = create_partner(db, payload.name)
    for domain in dict.fromkeys(payload.allowedDomains):
        create_manager_domain(db, domain, partner.id)
    for source in dict.fromkeys(payload.automatedSources):
        create_automated_source(db, source, partner.id)
    db.commit()
    db.refresh(partner)
    return partner


@router.get("/api/partners/{partner_id}", response_model=schemas.PartnerOut)
def get_partner_api(
    partner_id: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    return get_partner_or_404(db, partner_id)


@router.patch("/api/partners/{partner_id}", response_model=schemas.PartnerOut)
def update_partner_api(
    partner_id: str,
    payload: schemas.PartnerUpdateIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    return update_partner_name(db, partner_id, payload.name)


@router.delete("/api/partners/{partner_id}")
def delete_partner_api(
    partner_id: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    delete_partner_logo(partner_id)
    deleted_id = delete_partner(db, partner_id)
    return {"deleted": True, "partner_id": deleted_id}


@router.delete("/api/admin/automated-sources/{source_id}")
def admin_delete_automated_source(
    source_id: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    return {"deleted": delete_automated_source(db, source_id)}


@router.get("/api/admin/duplicate-groups", response_model=List[schemas.DuplicateGroupSummaryOut])
def list_duplicate_groups(
    partner_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """List duplicate groups with representative request info and member count."""
    if partner_id:
        get_partner_or_404(db, partner_id)

    q = db.query(models.DuplicateGroup)
    if partner_id:
        q = q.filter(models.DuplicateGroup.partner_id == partner_id)
    if status:
        q = q.filter(models.DuplicateGroup.status == status)
    else:
        q = q.filter(models.DuplicateGroup.status == "active")

    groups = q.order_by(models.DuplicateGroup.created_at.desc()).limit(200).all()

    # Preload representative requests in one query.
    rep_ids = [
        g.representative_request_id
        for g in groups
        if g.representative_request_id
    ]
    rep_by_id: dict[str, models.ManagerRequest] = {}
    if rep_ids:
        for row in (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.id.in_(rep_ids))
            .all()
        ):
            rep_by_id[row.id] = row

    # Preload member counts in one query.
    from sqlalchemy import func as sa_func
    group_ids = [g.id for g in groups]
    member_counts: dict[str, int] = {}
    if group_ids:
        rows = (
            db.query(
                models.ManagerRequest.duplicate_group_id,
                sa_func.count(models.ManagerRequest.id),
            )
            .filter(models.ManagerRequest.duplicate_group_id.in_(group_ids))
            .group_by(models.ManagerRequest.duplicate_group_id)
            .all()
        )
        for group_id_val, cnt in rows:
            member_counts[group_id_val] = int(cnt)

    result = []
    for group in groups:
        rep = rep_by_id.get(group.representative_request_id or "")
        rep_person = None
        if rep:
            rep_person = {
                "firstName": rep.person_first_name,
                "lastName": rep.person_last_name,
                "email": rep.person_email,
                "location": rep.person_location,
            }
        result.append({
            "id": group.id,
            "partnerId": group.partner_id,
            "classification": group.classification,
            "status": group.status,
            "createdAt": group.created_at,
            "memberCount": member_counts.get(group.id, 0),
            "representativeRequestId": group.representative_request_id,
            "directoryPersonId": group.directory_person_id,
            "representativePerson": rep_person,
        })
    return result


@router.get("/api/duplicate-groups/{group_id}", response_model=schemas.DuplicateGroupDetailOut)
def get_duplicate_group_details(
    group_id: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    group = db.query(models.DuplicateGroup).filter(models.DuplicateGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Duplicate group not found")

    members = get_group_members(db, group_id)
    hydrate_request_display(members)
    hydrate_request_users(db, members)

    # We dynamically select the latest request instead of relying on the DB column
    latest_req_id = members[-1].id if members else None

    member_out = []
    from app.intake_persons import get_director_fields
    for m in members:
        api = request_to_api_dict(m, db=db, persist_auto_mail_side_effects=False)
        dir_fields = get_director_fields(m)
        member_out.append({
            "id": m.id,
            "displayId": getattr(m, "displayId", None) or 0,
            "receivedAt": m.received_at,
            "person": {
                "firstName": m.person_first_name,
                "lastName": m.person_last_name,
                "email": m.person_email,
                "location": m.person_location,
                "role": getattr(m, "role", None),
                "directorFirst": dir_fields["firstName"] or None,
                "directorLast": dir_fields["lastName"] or None,
            },
            "directorFirst": dir_fields["firstName"] or None,
            "directorLast": dir_fields["lastName"] or None,
            "action": m.action,
            "status": m.status,
            "isRepresentative": m.id == latest_req_id,
            "submittedBy": api.get("submittedBy"),
            "notes": api.get("notes"),
            "tags": api.get("tags") or [],
            "createdBy": api.get("createdBy"),
        })

    # Compute aggregated classification summary for this group
    classification_summary = compute_group_classification_summary(db, group, members=members)

    directory_person = None
    if group.directory_person_id:
        dir_row = (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.id == group.directory_person_id)
            .first()
        )
        if dir_row:
            from app.manager_request_serialize import directory_person_to_api_dict
            directory_person = directory_person_to_api_dict(dir_row, db=db)

    return {
        "id": group.id,
        "partnerId": group.partner_id,
        "classification": group.classification,
        "status": group.status,
        "createdAt": group.created_at,
        "resolvedAt": group.resolved_at,
        "directoryPersonId": group.directory_person_id,
        "directoryPerson": directory_person,
        "representativeRequestId": group.representative_request_id,
        "members": member_out,
        "classificationSummary": classification_summary,
    }


@router.post("/api/duplicate-groups/{group_id}/unlink")
def unlink_duplicate_group_members_api(
    group_id: str,
    payload: schemas.UnlinkDuplicateIn,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    """Admin dismisses a false-positive duplicate pair within a group.

    Persists the dismissed pair so the grouping engine will never re-pair them.
    The router commits after the service flushes.
    """
    from app.duplicate_group_service import unlink_duplicate_members
    admin_id = str(admin.id) if getattr(admin, "id", None) else None
    result = unlink_duplicate_members(
        db, group_id, payload.requestId1, payload.requestId2, admin_id=admin_id, strict_single=payload.strictSingle
    )
    if not result:
        raise HTTPException(status_code=404, detail="Could not unlink duplicate group members")

    db.commit()
    return {
        "status": "unlinked",
        "unlinkedIds": result.get("unlinkedIds") or [payload.requestId2],
        "newGroupId": result.get("newGroupId"),
    }


@router.post("/api/duplicate-groups/{group_id}/resolve")
def resolve_duplicate_group_api(
    group_id: str,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    group = db.query(models.DuplicateGroup).filter(models.DuplicateGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Duplicate group not found")

    group.status = "resolved"
    group.resolved_at = datetime.now(timezone.utc)
    if getattr(admin, "id", None) and str(admin.id) != "dev-bypass":
        group.resolved_by_admin_id = str(admin.id)
    db.commit()
    return {"status": "resolved"}

# ── Task 2: Resolve & Add (Case A) ────────────────────────────────────────────

@router.post(
    "/api/duplicate-groups/{group_id}/resolve-add",
    response_model=schemas.ResolveGroupResultOut,
)
def resolve_group_add_api(
    group_id: str,
    payload: schemas.ResolveAndAddIn,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    """Case A — no Directory person exists for this group.

    Creates ONE new Directory record from the submitted finalValues, then marks all
    group member requests as resolved. The original request rows are never mutated.

    Rejects the call if the group already has a directory_person_id (use resolve-update
    or resolve-keep-existing instead).
    """
    from app.duplicate_group_service import resolve_group_add

    group = db.query(models.DuplicateGroup).filter(models.DuplicateGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Duplicate group not found")
    if group.status != "active":
        raise HTTPException(status_code=409, detail=f"Group is already '{group.status}'. Cannot resolve again")
    if group.directory_person_id:
        raise HTTPException(
            status_code=409,
            detail="This group is already linked to a Directory person. Use resolve-update or resolve-keep-existing.",
        )

    admin_id = str(admin.id) if getattr(admin, "id", None) else None
    members = get_group_members(db, group.id)
    member_count = len(members)

    try:
        dir_row = resolve_group_add(
            db, group,
            final_values=payload.finalValues,
            admin_id=admin_id,
            partner_id=group.partner_id,
            admin_note=payload.adminNote,
            source_request_id=payload.sourceRequestId,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    db.commit()

    # Notify realtime listeners that pending requests changed.
    notify_admin_requests_changed("group_resolve_add")

    return {
        "status": "resolved",
        "groupId": group_id,
        "resolutionType": "add",
        "directoryPersonId": dir_row.id,
        "resolvedRequestCount": member_count,
    }


# ── Task 2: Resolve & Update — Preview (dry run) ──────────────────────────────

@router.post(
    "/api/duplicate-groups/{group_id}/resolve-update/preview",
    response_model=schemas.ResolvePreviewOut,
)
def resolve_group_update_preview_api(
    group_id: str,
    payload: schemas.ResolveAndUpdatePreviewIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """Case B dry run — returns current Directory values vs proposed finalValues.

    No writes. Call this before resolve-update to power the confirmation dialog.
    """
    from app.duplicate_group_service import preview_resolve_update

    group = db.query(models.DuplicateGroup).filter(models.DuplicateGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Duplicate group not found")
    if not group.directory_person_id:
        raise HTTPException(
            status_code=409,
            detail="This group has no linked Directory person. Use resolve-add for Case A groups.",
        )
    if group.directory_person_id != payload.directoryPersonId:
        raise HTTPException(
            status_code=409,
            detail="directoryPersonId does not match the group's linked Directory person.",
        )

    dir_person = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id == payload.directoryPersonId)
        .first()
    )
    if not dir_person:
        raise HTTPException(status_code=404, detail="Directory person not found")

    return preview_resolve_update(dir_person, payload.finalValues)


# ── Task 2: Resolve & Update (Case B) ─────────────────────────────────────────

@router.post(
    "/api/duplicate-groups/{group_id}/resolve-update",
    response_model=schemas.ResolveGroupResultOut,
)
def resolve_group_update_api(
    group_id: str,
    payload: schemas.ResolveAndUpdateIn,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    """Case B — Directory person exists, update it in-place with finalValues.

    Rejects the call if the group has no directory_person_id, or if the submitted
    directoryPersonId does not match the group's linked person — never silently creates
    a second Directory record.
    """
    from app.duplicate_group_service import resolve_group_update

    group = db.query(models.DuplicateGroup).filter(models.DuplicateGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Duplicate group not found")
    if group.status != "active":
        raise HTTPException(status_code=409, detail=f"Group is already '{group.status}'. Cannot resolve again")
    if not group.directory_person_id:
        raise HTTPException(
            status_code=409,
            detail="This group has no linked Directory person. Use resolve-add for Case A groups.",
        )
    if group.directory_person_id != payload.directoryPersonId:
        raise HTTPException(
            status_code=409,
            detail="directoryPersonId does not match the group's linked Directory person.",
        )

    dir_person = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id == payload.directoryPersonId)
        .first()
    )
    if not dir_person:
        raise HTTPException(status_code=404, detail="Directory person not found")

    admin_id = str(admin.id) if getattr(admin, "id", None) else None
    members = get_group_members(db, group.id)
    member_count = len(members)

    try:
        resolve_group_update(
            db, group, dir_person,
            final_values=payload.finalValues,
            admin_id=admin_id,
            admin_note=payload.adminNote,
            source_request_id=payload.sourceRequestId,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    db.commit()
    notify_admin_requests_changed("group_resolve_update")

    return {
        "status": "resolved",
        "groupId": group_id,
        "resolutionType": "update",
        "directoryPersonId": dir_person.id,
        "resolvedRequestCount": member_count,
    }


# ── Task 2: Resolve — Keep Existing (Case C) ──────────────────────────────────

@router.post(
    "/api/duplicate-groups/{group_id}/resolve-keep-existing",
    response_model=schemas.ResolveGroupResultOut,
)
def resolve_group_keep_existing_api(
    group_id: str,
    payload: schemas.ResolveKeepExistingIn = schemas.ResolveKeepExistingIn(),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    """Case C — Directory record unchanged; incoming requests are discarded as incorrect.

    Marks all group member requests as resolved (status='handled',
    outcome='GroupResolved') without touching the linked Directory person. The group is
    stamped with resolution_type='keep_existing' for audit purposes.
    """
    from app.duplicate_group_service import resolve_group_keep_existing

    group = db.query(models.DuplicateGroup).filter(models.DuplicateGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Duplicate group not found")
    if group.status != "active":
        raise HTTPException(status_code=409, detail=f"Group is already '{group.status}'. Cannot resolve again")

    admin_id = str(admin.id) if getattr(admin, "id", None) else None

    count = resolve_group_keep_existing(
        db, group,
        admin_id=admin_id,
        admin_note=payload.adminNote,
    )
    dir_person_id = group.directory_person_id
    db.commit()
    notify_admin_requests_changed("group_resolve_keep")

    return {
        "status": "resolved",
        "groupId": group_id,
        "resolutionType": "keep_existing",
        "directoryPersonId": dir_person_id,
        "resolvedRequestCount": count,
    }


# ── Task 2: Resolve & Delete from Directory (Case D) ──────────────────────────

@router.post(
    "/api/duplicate-groups/{group_id}/resolve-delete-directory",
    response_model=schemas.ResolveGroupResultOut,
)
def resolve_group_delete_directory_api(
    group_id: str,
    payload: schemas.ResolveDeleteIn,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    from app.duplicate_group_service import resolve_group_delete_from_directory

    group = db.query(models.DuplicateGroup).filter(models.DuplicateGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Duplicate group not found")
    if group.status != "active":
        raise HTTPException(status_code=409, detail=f"Group is already '{group.status}' — cannot resolve again")
    if not group.directory_person_id:
        raise HTTPException(status_code=400, detail="Group is not linked to a Directory record.")
    if group.directory_person_id != payload.directoryPersonId:
        raise HTTPException(status_code=400, detail="Mismatch on directoryPersonId.")

    dir_person = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == group.directory_person_id).first()
    if not dir_person:
        raise HTTPException(status_code=404, detail="Linked Directory record not found.")

    admin_id = str(admin.id) if getattr(admin, "id", None) else None

    count = resolve_group_delete_from_directory(
        db, group, directory_person=dir_person, final_values=payload.finalValues, admin_id=admin_id, admin_note=payload.adminNote, source_request_id=payload.sourceRequestId
    )

    db.commit()
    notify_admin_requests_changed("group_resolve_delete")

    return {
        "status": "resolved",
        "groupId": group_id,
        "resolutionType": "delete",
        "directoryPersonId": payload.directoryPersonId,
        "resolvedRequestCount": count,
    }


# ── Task 2: Resolve & Mark as Removed (Case E) ────────────────────────────────

@router.post(
    "/api/duplicate-groups/{group_id}/resolve-mark-removed",
    response_model=schemas.ResolveGroupResultOut,
)
def resolve_group_mark_removed_api(
    group_id: str,
    payload: schemas.ResolveMarkRemovedIn,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    from app.duplicate_group_service import resolve_group_mark_removed

    group = db.query(models.DuplicateGroup).filter(models.DuplicateGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Duplicate group not found")
    if group.status != "active":
        raise HTTPException(status_code=409, detail=f"Group is already '{group.status}' — cannot resolve again")

    admin_id = str(admin.id) if getattr(admin, "id", None) else None

    count = resolve_group_mark_removed(
        db, group, final_values=payload.finalValues, admin_id=admin_id, admin_note=payload.adminNote, source_request_id=payload.sourceRequestId
    )
    dir_person_id = group.directory_person_id
    db.commit()
    notify_admin_requests_changed("group_resolve_mark_removed")

    return {
        "status": "resolved",
        "groupId": group_id,
        "resolutionType": "mark_removed",
        "directoryPersonId": dir_person_id,
        "resolvedRequestCount": count,
    }


@router.get("/api/manager/partner-branding")
def manager_partner_branding(
    partner_id: Optional[str] = None,
    partner_slug: Optional[str] = None,
    db: Session = Depends(get_db),
    manager=Depends(require_manager),
    x_partner_id: Optional[str] = Header(None, alias="X-Partner-Id"),
    x_partner_slug: Optional[str] = Header(None, alias="X-Partner-Slug"),
):
    """Partner name and optional logo for the signed-in manager's submission form."""
    resolved_partner_id = _manager_partner_id(
        db,
        manager.email,
        partner_id=partner_id,
        manager_user_id=manager.id if manager else None,
        header_partner_id=x_partner_id,
        header_partner_slug=partner_slug or x_partner_slug,
    )
    partner = get_partner_or_404(db, resolved_partner_id)
    form = (
        db.query(models.PartnerCustomForm)
        .filter(models.PartnerCustomForm.partner_id == resolved_partner_id)
        .first()
    )
    if form:
        migrate_inline_logo_to_storage(db, form)
    logo = resolve_partner_logo(form)
    return {
        "partnerId": partner.id,
        "partnerName": partner.name,
        "logoUrl": logo,
        "logoDataUrl": logo,
    }


# ── Custom Manager Form Branding ──────────────────────────────────────────

def _get_or_create_partner_form(db: Session, partner_id: str) -> models.PartnerCustomForm:
    form = (
        db.query(models.PartnerCustomForm)
        .filter(models.PartnerCustomForm.partner_id == partner_id)
        .first()
    )
    if not form:
        form = models.PartnerCustomForm(partner_id=partner_id)
        db.add(form)
    return form


@router.get("/api/partners/{partner_id}/custom-form", response_model=schemas.PartnerCustomFormOut)
def get_partner_custom_form(partner_id: str, db: Session = Depends(get_db), admin=Depends(require_admin)):
    form = db.query(models.PartnerCustomForm).filter(models.PartnerCustomForm.partner_id == partner_id).first()
    if not form:
        return {"partner_id": partner_id, "logo_url": None, "logo_data_url": None, "fields": []}
    migrate_inline_logo_to_storage(db, form)
    return form


@router.post("/api/partners/{partner_id}/logo", response_model=schemas.PartnerLogoUploadOut)
def upload_partner_logo(
    partner_id: str,
    payload: schemas.PartnerLogoUploadIn,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    # Accept a base64 data URL as JSON rather than multipart/form-data: the
    # Vercel Python (serverless ASGI) runtime does not reliably deliver
    # multipart binary bodies, which surfaced as "Failed to fetch" in the client.
    get_partner_or_404(db, partner_id)
    if not storage_enabled():
        raise HTTPException(
            status_code=503,
            detail="Logo storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        )

    try:
        logo_url = upload_partner_logo_from_data_url(partner_id, payload.logo_data_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    form = _get_or_create_partner_form(db, partner_id)
    form.logo_url = logo_url
    form.logo_data_url = None
    form.fields = form.fields or []
    db.commit()
    return {"partner_id": partner_id, "logo_url": logo_url}


@router.delete("/api/partners/{partner_id}/logo")
def remove_partner_logo(
    partner_id: str,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    get_partner_or_404(db, partner_id)
    delete_partner_logo(partner_id)
    form = db.query(models.PartnerCustomForm).filter(models.PartnerCustomForm.partner_id == partner_id).first()
    if form:
        form.logo_url = None
        form.logo_data_url = None
        db.commit()
    return {"partner_id": partner_id, "deleted": True}


@router.put("/api/partners/{partner_id}/custom-form", response_model=schemas.PartnerCustomFormOut)
def update_partner_custom_form(
    partner_id: str,
    payload: schemas.PartnerCustomFormIn,
    db: Session = Depends(get_db),
    admin=Depends(require_admin)
):
    get_partner_or_404(db, partner_id)
    form = _get_or_create_partner_form(db, partner_id)

    if payload.logo_data_url and storage_enabled():
        try:
            form.logo_url = upload_partner_logo_from_data_url(partner_id, payload.logo_data_url)
            form.logo_data_url = None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    elif payload.logo_url is not None:
        form.logo_url = payload.logo_url
        if payload.logo_url:
            form.logo_data_url = None
    elif payload.logo_data_url is not None:
        form.logo_data_url = payload.logo_data_url
        if payload.logo_data_url is None:
            delete_partner_logo(partner_id)
            form.logo_url = None

    form.fields = payload.fields
    db.commit()
    db.refresh(form)
    return form


@router.get("/api/public/custom-form/{partner_slug}")
def get_public_custom_form(partner_slug: str, db: Session = Depends(get_db)):
    import re
    partners = db.query(models.Partner).all()

    target_partner = None
    for p in partners:
        slug = re.sub(r'[^a-z0-9-]', '', re.sub(r'\s+', '-', p.name.lower()))
        if slug == partner_slug:
            target_partner = p
            break

    if not target_partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    form = db.query(models.PartnerCustomForm).filter(models.PartnerCustomForm.partner_id == target_partner.id).first()
    if form:
        migrate_inline_logo_to_storage(db, form)
    logo = resolve_partner_logo(form)
    return {
        "partnerName": target_partner.name,
        "logoUrl": logo,
        "logoDataUrl": logo,
        "fields": form.fields if form else [],
        "allowedDomains": list_manager_domain_strings(db, partner_id=target_partner.id),
    }
