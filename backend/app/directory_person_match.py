"""Directory conflict detection for already-exists tagging and comparison."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app import models, read_cache, schemas
from app.intake_persons import bootstrap_intake_persons, get_auto_mail_snapshot, get_partner_snapshot
from app.manager_request_tags import TAG_ALREADY_EXISTS
from app.person_match import person_from_model, same_person, same_person_for_partner
from app.duplicate_matching import (
    are_requests_dismissed,
    get_all_dismissed_pairs,
    is_gll_partner,
    is_healthtech_partner,
)

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


def _row_person_fields(row: models.ManagerRequest) -> tuple[str, str, str, str]:
    return (
        (row.person_email or "").strip().lower(),
        (row.person_first_name or "").strip().lower(),
        (row.person_last_name or "").strip().lower(),
        (row.person_location or "").strip().lower(),
    )


def _manager_form_matched_field_keys(
    *,
    email: str,
    first: str,
    last: str,
    location: str,
    row: models.ManagerRequest,
) -> set[str]:
    """Field keys where the form and directory row both have a value and they match."""
    r_email, r_first, r_last, r_loc = _row_person_fields(row)
    matched: set[str] = set()
    if email and r_email and email == r_email:
        matched.add("email")
    if first and r_first and first == r_first:
        matched.add("firstName")
    if last and r_last and last == r_last:
        matched.add("lastName")
    if location and r_loc and location == r_loc:
        matched.add("location")
    return matched


def manager_form_directory_overlap_reasons(
    *,
    email: str,
    first: str,
    last: str,
    location: str,
    row: models.ManagerRequest,
    is_gll: bool = False,
) -> set[str]:
    """Manager Check Directory / match-candidates warning reasons.

    Non-GLL (name is one entity among {Name, Email, Location}):
      Exact same email alone is a complete match (warn as Email).
      Otherwise warn when at least two entities match:
        Name+Location (Name = first AND last both match).
      Name alone, first+location, last+location → no warn.

    GLL (first/last stay separate; no location):
      Exact same email alone warns as Email; otherwise at least two of
      {first, last, email}.
    """
    matched = _manager_form_matched_field_keys(
        email=email,
        first=first,
        last=last,
        location=location,
        row=row,
    )

    if is_gll:
        if "email" in matched:
            reasons: set[str] = {"Email"}
            if "firstName" in matched and "lastName" in matched:
                reasons.add("Name")
            return reasons
        if len(matched) < 2:
            return set()
        reasons = set()
        if "firstName" in matched and "lastName" in matched:
            reasons.add("Name")
        if not reasons:
            reasons.add("Match")
        return reasons

    name_match = "firstName" in matched and "lastName" in matched
    email_match = "email" in matched
    loc_match = "location" in matched
    if email_match:
        reasons = {"Email"}
        if name_match:
            reasons.add("Name")
        return reasons
    if sum((name_match, email_match, loc_match)) < 2:
        return set()

    reasons = set()
    if name_match:
        reasons.add("Name")
    if loc_match and name_match and not email_match:
        reasons.add("Location")
    if not reasons:
        reasons.add("Match")
    return reasons


def _is_gll(db: Optional[Session], partner_id: Optional[str]) -> bool:
    """Thin wrapper — returns True when this partner is GLL."""
    return is_gll_partner(db, partner_id) if db and partner_id else False


_PROBE_ROSTER_LIMIT = 80
_PROBE_EMAIL_LIMIT = 25


def _probe_clause_specs(
    email: str,
    first: str,
    last: str,
    location: str,
    *,
    is_gll: bool,
) -> List[dict[str, str]]:
    """Person-probe match rules. Each spec is an AND of ``lower(column) == value``;
    a handled row is a candidate when any spec matches."""
    specs: List[dict[str, str]] = []
    if email:
        specs.append({"person_email": email})
    if first and last:
        specs.append({"person_first_name": first, "person_last_name": last})
    if email and first:
        specs.append({"person_email": email, "person_first_name": first})
    if email and last:
        specs.append({"person_email": email, "person_last_name": last})
    # Location-based clauses are omitted for GLL (no location field)
    if not is_gll:
        if email and location:
            specs.append({"person_email": email, "person_location": location})
        if first and last and location:
            specs.append({
                "person_first_name": first,
                "person_last_name": last,
                "person_location": location,
            })
        if first and location:
            specs.append({"person_first_name": first, "person_location": location})
        if last and location:
            specs.append({"person_last_name": last, "person_location": location})
    return specs


def _probe_spec_sql(spec: dict[str, str]):
    return and_(*[
        func.lower(getattr(models.ManagerRequest, column)) == value
        for column, value in spec.items()
    ])


def _row_matches_probe_spec(row: models.ManagerRequest, spec: dict[str, str]) -> bool:
    return all((getattr(row, column) or "").lower() == value for column, value in spec.items())


def _handled_ledger_query(db: Session, *, partner_id: Optional[str], include_archived: bool):
    query = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome.in_(DIRECTORY_LEDGER_OUTCOMES),
    )
    if not include_archived:
        query = query.filter(models.ManagerRequest.archived_at.is_(None))
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    return query


def _roster_sql_candidates(
    db: Session,
    *,
    email: str = "",
    first: str = "",
    last: str = "",
    location: str = "",
    partner_id: Optional[str] = None,
    limit: int = _PROBE_ROSTER_LIMIT,
    is_gll: bool = False,
    include_archived: bool = True,
) -> List[models.ManagerRequest]:
    """Fetch a small set of handled rows that may match a person probe."""
    specs = _probe_clause_specs(email, first, last, location, is_gll=is_gll)
    if not specs:
        return []
    query = _handled_ledger_query(db, partner_id=partner_id, include_archived=include_archived)
    return (
        query.filter(or_(*[_probe_spec_sql(spec) for spec in specs]))
        .order_by(models.ManagerRequest.handled_at.desc())
        .limit(limit)
        .all()
    )


def _probe_cache_key(
    fields: tuple[str, str, str, str],
    partner_id: Optional[str],
    include_archived: bool,
) -> tuple:
    return ("probe_handled_rows", *fields, partner_id or "", include_archived)


def prefetch_probe_handled_rows(
    db: Session,
    probes: List[tuple[schemas.PersonInfo, Optional[str]]],
    *,
    include_archived: bool = False,
) -> None:
    """Answer many ``_probe_handled_rows`` calls with one query per partner.

    Only effective inside ``read_cache_scope()``; results match the per-person
    queries (same rules, order, and limits), filtered in Python.
    """
    if not read_cache.is_active():
        return
    wanted_by_partner: dict[str, dict[tuple, tuple[str, List[dict[str, str]]]]] = {}
    for person, partner_id in probes:
        fields = _person_probe_fields(person)
        key = _probe_cache_key(fields, partner_id, include_archived)
        if read_cache.peek(key) is not None:
            continue
        specs = _probe_clause_specs(*fields, is_gll=_is_gll(db, partner_id))
        wanted_by_partner.setdefault(partner_id or "", {})[key] = (fields[0], specs)

    for partner_id, wanted in wanted_by_partner.items():
        all_specs = [spec for _, specs in wanted.values() for spec in specs]
        rows: List[models.ManagerRequest] = []
        if all_specs:
            rows = (
                _handled_ledger_query(db, partner_id=partner_id or None, include_archived=include_archived)
                .filter(or_(*[_probe_spec_sql(spec) for spec in all_specs]))
                .order_by(models.ManagerRequest.handled_at.desc())
                .all()
            )
        for key, (email, specs) in wanted.items():
            read_cache.seed(key, _select_probe_rows(rows, email, specs))


def _select_probe_rows(
    rows: List[models.ManagerRequest],
    email: str,
    specs: List[dict[str, str]],
) -> List[models.ManagerRequest]:
    matches = [row for row in rows if any(_row_matches_probe_spec(row, spec) for spec in specs)]
    by_id: dict[str, models.ManagerRequest] = {}
    for row in matches[:_PROBE_ROSTER_LIMIT]:
        by_id[row.id] = row
    if email:
        email_rows = [row for row in matches if (row.person_email or "").lower() == email]
        for row in email_rows[:_PROBE_EMAIL_LIMIT]:
            by_id[row.id] = row
    return list(by_id.values())


def _probe_handled_rows(
    db: Session,
    person: schemas.PersonInfo,
    *,
    partner_id: Optional[str] = None,
    include_archived: bool = False,
) -> List[models.ManagerRequest]:
    """Handled rows relevant to one person for conflict and roster checks."""
    fields = _person_probe_fields(person)
    cache_key = _probe_cache_key(fields, partner_id, include_archived)
    cached_rows = read_cache.peek(cache_key)
    if cached_rows is not None:
        return list(cached_rows)

    email, first, last, location = fields
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
        query = _handled_ledger_query(db, partner_id=partner_id, include_archived=include_archived).filter(
            func.lower(models.ManagerRequest.person_email) == email,
        )
        for row in query.order_by(models.ManagerRequest.handled_at.desc()).limit(_PROBE_EMAIL_LIMIT).all():
            by_id[row.id] = row

    rows = list(by_id.values())
    read_cache.seed(cache_key, rows)
    return list(rows)


def _directory_location_key(row: models.ManagerRequest) -> str:
    return (row.person_location or "").strip().lower()


def _is_same_directory_ledger_identity(
    left: models.ManagerRequest,
    right: models.ManagerRequest,
    *,
    is_ht: bool,
    is_gll: bool,
) -> bool:
    """True when two Directory rows collapse to one Active/Archived ledger entry.

    Matches the multi-Directory update-target rule: stacked same-location copies
    collapse; same email with different non-empty locations stay separately
    visible (and selectable) so an update to one location is not hidden behind
    another.
    """
    if not same_person_for_partner(
        left, right, is_healthtech=is_ht, is_gll=is_gll
    ):
        return False
    if is_gll:
        return True
    loc_l = _directory_location_key(left)
    loc_r = _directory_location_key(right)
    if loc_l and loc_r and loc_l != loc_r:
        return False
    return True


def _dedupe_current_outcome(
    rows: List[models.ManagerRequest],
    outcome: str,
    *,
    partner_id: Optional[str] = None,
    db: Optional[Session] = None,
    dismissed_set: Optional[set] = None,
) -> List[models.ManagerRequest]:
    is_ht = is_healthtech_partner(db, partner_id) if db and partner_id else False
    gll = _is_gll(db, partner_id)
    # One round-trip for dismissed pairs — per-pair DB lookups dominate Overview latency.
    if dismissed_set is None and db is not None:
        dismissed_set = get_all_dismissed_pairs(db)
    roster: List[models.ManagerRequest] = []
    represented: List[models.ManagerRequest] = []

    for row in sorted(rows, key=_handled_at_sort_key, reverse=True):
        if any(
            _is_same_directory_ledger_identity(
                row, prior, is_ht=is_ht, is_gll=gll
            )
            and not (
                db
                and are_requests_dismissed(db, row.id, prior.id, dismissed_set=dismissed_set)
            )
            for prior in represented
        ):
            continue
        represented.append(row)
        if row.outcome == outcome:
            roster.append(row)
    return roster


def _dedupe_latest_roster(
    rows: List[models.ManagerRequest],
    *,
    partner_id: Optional[str] = None,
    db: Optional[Session] = None,
    dismissed_set: Optional[set] = None,
) -> List[models.ManagerRequest]:
    return _dedupe_current_outcome(
        rows, "Added", partner_id=partner_id, db=db, dismissed_set=dismissed_set
    )


def _dedupe_gll_latest_added(
    rows: List[models.ManagerRequest],
    *,
    limit: int,
) -> List[models.ManagerRequest]:
    """O(n) Added-roster dedupe for GLL (identity is email-centric; bulk imports are huge)."""
    represented: List[models.ManagerRequest] = []
    seen_emails: set[str] = set()
    seen_name_only: set[str] = set()

    for row in sorted(rows, key=_handled_at_sort_key, reverse=True):
        email = (row.person_email or "").strip().lower()
        name_key = (
            f"{(row.person_first_name or '').strip().lower()}"
            f"\0{(row.person_last_name or '').strip().lower()}"
        )
        if email:
            if email in seen_emails:
                continue
            seen_emails.add(email)
        elif name_key in seen_name_only:
            continue
        else:
            seen_name_only.add(name_key)
        represented.append(row)
        if len(represented) >= limit:
            break
    return represented


def _dedupe_added_roster_limited(
    db: Session,
    rows: List[models.ManagerRequest],
    *,
    partner_id: Optional[str] = None,
    limit: int,
    dismissed_set: Optional[set] = None,
) -> List[models.ManagerRequest]:
    if _is_gll(db, partner_id):
        return _dedupe_gll_latest_added(rows, limit=limit)
    return _dedupe_latest_roster(
        rows, partner_id=partner_id, db=db, dismissed_set=dismissed_set
    )[:limit]


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


def _directory_text_search_clause(pattern: str):
    return or_(
        models.ManagerRequest.person_first_name.ilike(pattern),
        models.ManagerRequest.person_last_name.ilike(pattern),
        # Full name "first last" — `+` works on SQLite and Postgres (func.concat does not on SQLite).
        (
            models.ManagerRequest.person_first_name
            + " "
            + models.ManagerRequest.person_last_name
        ).ilike(pattern),
        models.ManagerRequest.person_email.ilike(pattern),
        models.ManagerRequest.person_location.ilike(pattern),
    )


def search_roster_rows(
    db: Session,
    query: str,
    *,
    limit: int = 25,
    partner_id: Optional[str] = None,
    outcome: str = "Added",
) -> List[models.ManagerRequest]:
    """Manager Directory search: every matching row for Active or Removed (no identity collapse)."""
    pattern = f"%{query}%"
    filters = [
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome.in_(DIRECTORY_LEDGER_OUTCOMES),
        _directory_text_search_clause(pattern),
    ]
    if outcome == "Removed":
        # Remove form: Removed rows only (never active Added), no identity collapse.
        filters.append(models.ManagerRequest.outcome == "Removed")
    else:
        filters.extend(
            [
                models.ManagerRequest.outcome == "Added",
                models.ManagerRequest.archived_at.is_(None),
            ]
        )
    query_obj = db.query(models.ManagerRequest).filter(*filters)
    if partner_id:
        query_obj = query_obj.filter(models.ManagerRequest.partner_id == partner_id)
    return (
        query_obj.order_by(models.ManagerRequest.handled_at.desc())
        .limit(limit)
        .all()
    )


def roster_snapshot_rows(
    db: Session,
    *,
    limit: int = 1000,
    partner_id: Optional[str] = None,
) -> List[models.ManagerRequest]:
    """Current Added Directory rows for a one-time client snapshot (no identity collapse)."""
    return directory_ledger_rows(db, limit=limit, partner_id=partner_id)


def _dedupe_latest_person(
    rows: List[models.ManagerRequest],
    *,
    partner_id: Optional[str] = None,
    db: Optional[Session] = None,
    dismissed_set: Optional[set] = None,
) -> List[models.ManagerRequest]:
    """Keep the most recent handled row per ledger identity (location-aware)."""
    is_ht = is_healthtech_partner(db, partner_id) if db and partner_id else False
    gll = _is_gll(db, partner_id)
    if dismissed_set is None and db is not None:
        dismissed_set = get_all_dismissed_pairs(db)
    represented: List[models.ManagerRequest] = []
    for row in sorted(rows, key=_handled_at_sort_key, reverse=True):
        if any(
            _is_same_directory_ledger_identity(
                row, prior, is_ht=is_ht, is_gll=gll
            )
            and not (
                db
                and are_requests_dismissed(db, row.id, prior.id, dismissed_set=dismissed_set)
            )
            for prior in represented
        ):
            continue
        represented.append(row)
    return represented


def directory_ledger_rows(
    db: Session,
    *,
    limit: Optional[int] = None,
    partner_id: Optional[str] = None,
    dismissed_set: Optional[set] = None,
) -> List[models.ManagerRequest]:
    """Active Directory list: every non-archived Added row (no identity collapse).

    ``dismissed_set`` is accepted for call-site compatibility and unused — Directory
    pages show stored rows as-is; match/conflict paths still collapse separately.

    When ``partner_id`` is set, all matching rows are returned (no artificial cap).
    Without a partner scope, ``limit`` defaults to 5000 as a safety bound.
    """
    del dismissed_set  # unused — listing is not identity-deduped
    query = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome == "Added",
        models.ManagerRequest.archived_at.is_(None),
    )
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    query = query.order_by(models.ManagerRequest.handled_at.desc())
    # Partner-scoped Directory pages pass limit=None → return every row.
    # Explicit limits (manager snapshot caps, tests) are still honored.
    effective_limit = limit if limit is not None else (None if partner_id else 5000)
    if effective_limit is not None:
        query = query.limit(effective_limit)
    return query.all()


def removed_snapshot_rows(
    db: Session,
    *,
    limit: Optional[int] = None,
    partner_id: Optional[str] = None,
) -> List[models.ManagerRequest]:
    """Manager Remove-form Directory: every outcome=Removed row (no identity collapse).

    Does not include active Added rows, even if manually archived_at is set.
    """
    query = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome == "Removed",
    )
    if partner_id:
        query = query.filter(models.ManagerRequest.partner_id == partner_id)
    query = query.order_by(models.ManagerRequest.handled_at.desc())
    effective_limit = limit if limit is not None else (None if partner_id else 5000)
    if effective_limit is not None:
        query = query.limit(effective_limit)
    return query.all()


def archived_snapshot_rows(
    db: Session,
    *,
    limit: Optional[int] = None,
    partner_id: Optional[str] = None,
    dismissed_set: Optional[set] = None,
) -> List[models.ManagerRequest]:
    """Archived Directory list: every Removed/archived row (no identity collapse).

    ``dismissed_set`` is accepted for call-site compatibility and unused.
    Partner-scoped lists with limit=None return every matching row.
    """
    del dismissed_set  # unused — listing is not identity-deduped
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
    query = query.order_by(
        models.ManagerRequest.handled_at.desc(),
        models.ManagerRequest.archived_at.desc(),
    )
    effective_limit = limit if limit is not None else (None if partner_id else 5000)
    if effective_limit is not None:
        query = query.limit(effective_limit)
    return query.all()


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
    outcome: str = "Added",
) -> List[models.ManagerRequest]:
    """Manager form overlap hits: every overlapping Active or Removed row (no collapse).

    Remove form uses outcome=Removed only (never Added rows).
    """
    email, first, last, location = _person_probe_fields(person)
    gll = _is_gll(db, partner_id)
    want_removed = outcome == "Removed"
    candidates = _roster_sql_candidates(
        db,
        email=email,
        first=first,
        last=last,
        location=location,
        partner_id=partner_id,
        is_gll=gll,
        include_archived=want_removed,
    )

    def _in_outcome_set(row: models.ManagerRequest) -> bool:
        if want_removed:
            return (row.outcome or "") == "Removed"
        return (row.outcome or "") == "Added" and getattr(row, "archived_at", None) is None

    matches = [
        row
        for row in sorted(candidates, key=_handled_at_sort_key, reverse=True)
        if _in_outcome_set(row)
        and manager_form_directory_overlap_reasons(
            email=email,
            first=first,
            last=last,
            location=location,
            row=row,
            is_gll=gll,
        )
    ]
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
