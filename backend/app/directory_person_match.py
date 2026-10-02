"""Directory conflict detection for already-exists tagging and comparison."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app import models, schemas
from app.intake_persons import bootstrap_intake_persons, get_auto_mail_snapshot, get_partner_snapshot
from app.manager_request_tags import TAG_ALREADY_EXISTS
from app.person_match import person_from_model, same_person, same_person_for_partner
from app.duplicate_matching import is_healthtech_partner, is_gll_partner, are_requests_dismissed

# Only true Directory ledger outcomes. GroupResolved (and similar) are
# historical merge inputs and must never appear as Directory people.
DIRECTORY_LEDGER_OUTCOMES = ("Added", "Removed")


def handled_directory_rows(
    db: Session,
    *,
    partner_id: Optional[str] = None,
    include_archived: bool = False,
) -> List[models.ManagerRequest]:
    query = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome.in_(DIRECTORY_LEDGER_OUTCOMES),
    )
    if not include_archived:
        query = query.filter(models.ManagerRequest.archived_at.is_(None))
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    return query.order_by(models.ManagerRequest.handled_at.desc()).all()


def directory_outcome_conflicts(action: str, outcome: Optional[str]) -> bool:
    """True when a new request repeats an Add/Remove that already applies in the ledger."""
    if action == "Add" and outcome == "Added":
        return True
    if action == "Remove" and outcome == "Removed":
        return True
    return False


def _handled_at_sort_key(row: models.ManagerRequest) -> datetime:
    return row.handled_at or row.received_at or datetime.min.replace(tzinfo=timezone.utc)


def _person_probe_fields(person: schemas.PersonInfo) -> tuple[str, str, str, str]:
    return (
        (person.email or "").strip().lower(),
        (person.firstName or "").strip().lower(),
        (person.lastName or "").strip().lower(),
        (person.location or "").strip().lower(),
    )


def _is_gll(db: Optional[Session], partner_id: Optional[str]) -> bool:
    """Thin wrapper — returns True when this partner is GLL."""
    return is_gll_partner(db, partner_id) if db and partner_id else False


def _roster_sql_candidates(
    db: Session,
    *,
    email: str = "",
    first: str = "",
    last: str = "",
    location: str = "",
    partner_id: Optional[str] = None,
    limit: int = 80,
    is_gll: bool = False,
    include_archived: bool = True,
) -> List[models.ManagerRequest]:
    """Fetch a small set of handled rows that may match a person probe."""
    clauses = []
    if email:
        clauses.append(func.lower(models.ManagerRequest.person_email) == email)
    if first and last:
        clauses.append(
            and_(
                func.lower(models.ManagerRequest.person_first_name) == first,
                func.lower(models.ManagerRequest.person_last_name) == last,
            )
        )
    # Location-based clauses are omitted for GLL (no location field)
    if not is_gll:
        if email and location:
            clauses.append(
                and_(
                    func.lower(models.ManagerRequest.person_email) == email,
                    func.lower(models.ManagerRequest.person_location) == location,
                )
            )
        if first and last and location:
            clauses.append(
                and_(
                    func.lower(models.ManagerRequest.person_first_name) == first,
                    func.lower(models.ManagerRequest.person_last_name) == last,
                    func.lower(models.ManagerRequest.person_location) == location,
                )
            )
        if first and location:
            clauses.append(
                and_(
                    func.lower(models.ManagerRequest.person_first_name) == first,
                    func.lower(models.ManagerRequest.person_location) == location,
                )
            )
        if last and location:
            clauses.append(
                and_(
                    func.lower(models.ManagerRequest.person_last_name) == last,
                    func.lower(models.ManagerRequest.person_location) == location,
                )
            )

    if not clauses:
        return []

    filters = [
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome.in_(DIRECTORY_LEDGER_OUTCOMES),
        or_(*clauses),
    ]
    if not include_archived:
        filters.append(models.ManagerRequest.archived_at.is_(None))

    query = db.query(models.ManagerRequest).filter(*filters)
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    return query.order_by(models.ManagerRequest.handled_at.desc()).limit(limit).all()


def _probe_handled_rows(
    db: Session,
    person: schemas.PersonInfo,
    *,
    partner_id: Optional[str] = None,
    include_archived: bool = False,
) -> List[models.ManagerRequest]:
    """Handled rows relevant to one person for conflict and roster checks."""
    email, first, last, location = _person_probe_fields(person)
    gll = _is_gll(db, partner_id)
    by_id: dict[str, models.ManagerRequest] = {}

    for row in _roster_sql_candidates(
        db,
        email=email,
        first=first,
        last=last,
        location=location,
        partner_id=partner_id,
        is_gll=gll,
        include_archived=include_archived,
    ):
        by_id[row.id] = row

    if email:
        query = db.query(models.ManagerRequest).filter(
            models.ManagerRequest.status == "handled",
            models.ManagerRequest.outcome.in_(DIRECTORY_LEDGER_OUTCOMES),
            func.lower(models.ManagerRequest.person_email) == email,
        )
        if not include_archived:
            query = query.filter(models.ManagerRequest.archived_at.is_(None))
        if partner_id:
            query = query.filter(models.ManagerRequest.partner_id == partner_id)
        for row in query.order_by(models.ManagerRequest.handled_at.desc()).limit(25).all():
            by_id[row.id] = row

    return list(by_id.values())


def _dedupe_current_outcome(
    rows: List[models.ManagerRequest],
    outcome: str,
    *,
    partner_id: Optional[str] = None,
    db: Optional[Session] = None,
) -> List[models.ManagerRequest]:
    is_ht = is_healthtech_partner(db, partner_id) if db and partner_id else False
    gll = _is_gll(db, partner_id)
    roster: List[models.ManagerRequest] = []
    represented: List[models.ManagerRequest] = []

    for row in sorted(rows, key=_handled_at_sort_key, reverse=True):
        if any(
            same_person_for_partner(row, prior, is_healthtech=is_ht, is_gll=gll)
            and not (db and are_requests_dismissed(db, row.id, prior.id))
            for prior in represented
        ):
            continue
        represented.append(row)
        if row.outcome == outcome:
            roster.append(row)
    return roster


def _dedupe_latest_roster(rows: List[models.ManagerRequest], *, partner_id: Optional[str] = None, db: Optional[Session] = None) -> List[models.ManagerRequest]:
    return _dedupe_current_outcome(rows, "Added", partner_id=partner_id, db=db)


def find_latest_directory_match(
    person: schemas.PersonInfo,
    directory_rows: List[models.ManagerRequest],
    *,
    is_healthtech: bool = False,
    is_gll: bool = False,
    db: Optional[Session] = None,
    req_id: Optional[str] = None,
) -> Optional[models.ManagerRequest]:
    """Most recent handled row for the same person (partner-aware same_person rules)."""
    for row in sorted(directory_rows, key=_handled_at_sort_key, reverse=True):
        if db and req_id and are_requests_dismissed(db, req_id, row.id):
            continue
        if same_person_for_partner(row, person, is_healthtech=is_healthtech, is_gll=is_gll):
            return row
    return None


def find_directory_conflict(
    *,
    person: schemas.PersonInfo,
    action: str,
    directory_rows: List[models.ManagerRequest],
    is_healthtech: bool = False,
    is_gll: bool = False,
    db: Optional[Session] = None,
    req_id: Optional[str] = None,
) -> Optional[models.ManagerRequest]:
    """Directory row that triggers already-exists or already-removed for this request action."""
    match = find_latest_directory_match(
        person,
        directory_rows,
        is_healthtech=is_healthtech,
        is_gll=is_gll,
        db=db,
        req_id=req_id,
    )
    if match and directory_outcome_conflicts(action, match.outcome):
        return match
    return None


def search_roster_rows(
    db: Session,
    query: str,
    *,
    limit: int = 25,
    partner_id: Optional[str] = None,
) -> List[models.ManagerRequest]:
    """Server-side roster search by person name, email, or location."""
    pattern = f"%{query}%"
    query_obj = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome == "Added",
        models.ManagerRequest.archived_at.is_(None),
        or_(
            models.ManagerRequest.person_first_name.ilike(pattern),
            models.ManagerRequest.person_last_name.ilike(pattern),
            # Full name "first last" style queries
            func.concat(
                models.ManagerRequest.person_first_name,
                " ",
                models.ManagerRequest.person_last_name,
            ).ilike(pattern),
            models.ManagerRequest.person_email.ilike(pattern),
            models.ManagerRequest.person_location.ilike(pattern),
        ),
    )
    if partner_id:
        query_obj = query_obj.filter(models.ManagerRequest.partner_id == partner_id)
    rows = (
        query_obj.order_by(models.ManagerRequest.handled_at.desc())
        .limit(max(limit * 4, limit))
        .all()
    )
    return _dedupe_latest_roster(rows)[:limit]


def roster_snapshot_rows(
    db: Session,
    *,
    limit: int = 1000,
    partner_id: Optional[str] = None,
) -> List[models.ManagerRequest]:
    """Current Added roster for a one-time client snapshot (background load)."""
    query = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome == "Added",
        models.ManagerRequest.archived_at.is_(None),
    )
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    rows = query.order_by(models.ManagerRequest.handled_at.desc()).limit(max(limit * 4, limit)).all()
    return _dedupe_latest_roster(rows, partner_id=partner_id, db=db)[:limit]


def _dedupe_latest_person(rows: List[models.ManagerRequest], *, partner_id: Optional[str] = None, db: Optional[Session] = None) -> List[models.ManagerRequest]:
    """Keep the most recent handled row per person, regardless of Added/Removed."""
    is_ht = is_healthtech_partner(db, partner_id) if db and partner_id else False
    gll = _is_gll(db, partner_id)
    represented: List[models.ManagerRequest] = []
    for row in sorted(rows, key=_handled_at_sort_key, reverse=True):
        if any(
            same_person_for_partner(row, prior, is_healthtech=is_ht, is_gll=gll)
            and not (db and are_requests_dismissed(db, row.id, prior.id))
            for prior in represented
        ):
            continue
        represented.append(row)
    return represented


def directory_ledger_rows(
    db: Session,
    *,
    limit: int = 1000,
    partner_id: Optional[str] = None,
) -> List[models.ManagerRequest]:
    """Active Directory ledger: latest non-archived Added state per person."""
    query = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome == "Added",
        models.ManagerRequest.archived_at.is_(None),
    )
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    rows = query.order_by(models.ManagerRequest.handled_at.desc()).limit(max(limit * 4, limit)).all()
    return _dedupe_latest_roster(rows, partner_id=partner_id, db=db)[:limit]


def removed_snapshot_rows(
    db: Session,
    *,
    limit: int = 1000,
    partner_id: Optional[str] = None,
) -> List[models.ManagerRequest]:
    """People currently off the roster (latest handled state is Removed)."""
    query = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome.in_(DIRECTORY_LEDGER_OUTCOMES),
    )
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    rows = query.order_by(models.ManagerRequest.handled_at.desc()).limit(max(limit * 4, limit)).all()
    return _dedupe_current_outcome(rows, "Removed", partner_id=partner_id, db=db)[:limit]


def archived_snapshot_rows(
    db: Session,
    *,
    limit: int = 1000,
    partner_id: Optional[str] = None,
) -> List[models.ManagerRequest]:
    """People currently archived or removed from the directory."""
    query = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome.in_(DIRECTORY_LEDGER_OUTCOMES),
        or_(
            models.ManagerRequest.outcome == "Removed",
            models.ManagerRequest.archived_at.isnot(None),
        ),
    )
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    rows = query.order_by(models.ManagerRequest.handled_at.desc(), models.ManagerRequest.archived_at.desc()).limit(max(limit * 4, limit)).all()
    return _dedupe_latest_person(rows, partner_id=partner_id, db=db)[:limit]


def active_roster_rows(db: Session, *, partner_id: Optional[str] = None) -> List[models.ManagerRequest]:
    """People currently on the roster (latest handled state is Added)."""
    handled = handled_directory_rows(db)
    if partner_id:
        handled = [row for row in handled if row.partner_id == partner_id]
    return _dedupe_latest_roster(handled, partner_id=partner_id, db=db)


def find_roster_person(
    db: Session,
    person: schemas.PersonInfo,
    *,
    partner_id: Optional[str] = None,
) -> Optional[models.ManagerRequest]:
    """Latest directory row when the person is currently Added to the roster."""
    is_ht = is_healthtech_partner(db, partner_id)
    gll = _is_gll(db, partner_id)
    match = find_latest_directory_match(
        person,
        _probe_handled_rows(db, person, partner_id=partner_id),
        is_healthtech=is_ht,
        is_gll=gll,
    )
    if match and match.outcome == "Added":
        return match
    return None


def roster_match_candidates(
    db: Session,
    person: schemas.PersonInfo,
    *,
    limit: int = 10,
    partner_id: Optional[str] = None,
) -> List[models.ManagerRequest]:
    """Roster rows that match the person probe (same_person rules)."""
    email, first, last, location = _person_probe_fields(person)
    gll = _is_gll(db, partner_id)
    candidates = _roster_sql_candidates(
        db,
        email=email,
        first=first,
        last=last,
        location=location,
        partner_id=partner_id,
        is_gll=gll,
    )
    roster = _dedupe_latest_roster(candidates, partner_id=partner_id, db=db)
    is_ht = is_healthtech_partner(db, partner_id)
    matches = [row for row in roster if same_person_for_partner(row, person, is_healthtech=is_ht, is_gll=gll)]
    return matches[:limit]


def request_person_for_match(req: models.ManagerRequest) -> schemas.PersonInfo:
    bootstrap_intake_persons(req)
    partner = get_partner_snapshot(req)
    if partner:
        return partner
    auto_mail = get_auto_mail_snapshot(req)
    if auto_mail:
        return auto_mail
    return person_from_model(req)


def duplicate_tags_for_person(
    db: Session,
    person: schemas.PersonInfo,
    *,
    action: str,
    partner_id: Optional[str] = None,
    req_id: Optional[str] = None,
) -> List[str]:
    is_ht = is_healthtech_partner(db, partner_id)
    gll = _is_gll(db, partner_id)
    match = find_directory_conflict(
        person=person,
        action=action,
        directory_rows=_probe_handled_rows(db, person, partner_id=partner_id),
        is_healthtech=is_ht,
        is_gll=gll,
        db=db,
        req_id=req_id,
    )
    if match:
        from app.manager_request_tags import TAG_ALREADY_REMOVED
        if match.outcome == "Removed":
            return [TAG_ALREADY_REMOVED]
        return [TAG_ALREADY_EXISTS]
    return []
