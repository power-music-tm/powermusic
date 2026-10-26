"""Service functions for grouping related duplicate requests, maintaining representative requests,
and handling admin unlinking decisions.

Design constraints
──────────────────
* Do NOT modify or overwrite original request field values (first_name, email, …).
  Groups store the *relationship* between requests, not merged data.
* Each request keeps its original snapshot for audit/history purposes.
* The representative request is always the *latest* (by received_at) active member.
* db.commit() is intentionally absent here — callers (routers) commit.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified


def _norm_dt(dt: Optional[datetime]) -> datetime:
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt

from app import models, read_cache, schemas
from app.duplicate_matching import (
    are_requests_dismissed,
    get_all_dismissed_pairs,
    is_gll_partner,
    is_healthtech_from_request,
    is_gll_from_request,
    is_healthtech_partner,
    match_classification,
    match_classification_for_partner,
)
from app.manager_request_tags import (
    TAG_ALREADY_EXISTS,
    TAG_ALREADY_REMOVED,
    TAG_CONFIRMED_DUPLICATE,
    TAG_POTENTIAL_DUPLICATE,
    merge_tags,
)
from app.person_match import person_from_model, same_person_for_partner


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _new_group_id() -> str:
    return f"dup-grp-{uuid.uuid4().hex[:12]}"


def _clear_duplicate_tags(req: models.ManagerRequest) -> None:
    """Scrub all duplicate-related tags from a request."""
    if not req.tags:
        return
    from app.manager_request_tags import TAG_ALREADY_REMOVED
    tags_to_remove = {TAG_CONFIRMED_DUPLICATE, TAG_POTENTIAL_DUPLICATE, TAG_ALREADY_EXISTS, TAG_ALREADY_REMOVED}
    original_len = len(req.tags)
    req.tags = [t for t in req.tags if t not in tags_to_remove]
    if len(req.tags) != original_len:
        flag_modified(req, "tags")


def _best_classification(
    classification_a: Optional[str],
    classification_b: Optional[str],
) -> Optional[str]:
    """Return the more severe of two classification strings.

    Severity order: confirmed_duplicate > already_exists_conflict > already_removed_conflict > potential_duplicate > already_exists > already_removed > None
    """
    order = {
        "confirmed_duplicate": 6,
        "already_exists_conflict": 5,
        "already_removed_conflict": 4,
        "potential_duplicate": 3,
        "already_exists": 2,
        "already_removed": 1,
        None: 0,
    }
    if order.get(classification_a, 0) >= order.get(classification_b, 0):
        return classification_a
    return classification_b


def _pending_candidates(
    db: Session,
    req: models.ManagerRequest,
    *,
    exclude_id: Optional[str] = None,
    limit: int = 100,
) -> List[models.ManagerRequest]:
    """Fetch candidate new requests in the same partner context matching last_name or email."""
    q = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "new",
    )
    if exclude_id:
        q = q.filter(models.ManagerRequest.id != exclude_id)
    if req.partner_id:
        q = q.filter(models.ManagerRequest.partner_id == req.partner_id)

    from sqlalchemy import func, and_
    last_name = (req.person_last_name or "").strip().lower()
    first_name = (req.person_first_name or "").strip().lower()
    email = (req.person_email or "").strip().lower()
    filters = []
    if last_name:
        filters.append(func.lower(models.ManagerRequest.person_last_name) == last_name)
    if email:
        filters.append(func.lower(models.ManagerRequest.person_email) == email)
    if first_name and len(first_name) >= 3 and last_name and len(last_name) >= 3:
        filters.append(and_(
            func.lower(models.ManagerRequest.person_first_name).startswith(first_name[:3]),
            func.lower(models.ManagerRequest.person_last_name).startswith(last_name[:3])
        ))
    if filters:
        q = q.filter(or_(*filters))

    return q.order_by(models.ManagerRequest.received_at.desc()).limit(limit).all()


def _directory_candidates(
    db: Session,
    req: models.ManagerRequest,
    *,
    limit: int = 100,
) -> List[models.ManagerRequest]:
    """Fetch handled directory rows for conflict detection matching last_name or email.

    Ordering is stable by id (not handled_at) so multi-match discovery does not
    prefer the newest record. Callers must evaluate *all* returned candidates.
    """
    q = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.outcome.in_(("Added", "Removed")),
    )
    if req.partner_id:
        q = q.filter(models.ManagerRequest.partner_id == req.partner_id)

    from sqlalchemy import func, and_
    last_name = (req.person_last_name or "").strip().lower()
    first_name = (req.person_first_name or "").strip().lower()
    email = (req.person_email or "").strip().lower()
    filters = []
    if last_name:
        filters.append(func.lower(models.ManagerRequest.person_last_name) == last_name)
    if email:
        filters.append(func.lower(models.ManagerRequest.person_email) == email)
    if first_name and len(first_name) >= 3 and last_name and len(last_name) >= 3:
        filters.append(and_(
            func.lower(models.ManagerRequest.person_first_name).startswith(first_name[:3]),
            func.lower(models.ManagerRequest.person_last_name).startswith(last_name[:3])
        ))
    if filters:
        q = q.filter(or_(*filters))

    return q.order_by(models.ManagerRequest.id.asc()).limit(limit).all()


def _directory_is_off_roster(person: Optional[models.ManagerRequest]) -> bool:
    """True when the Directory row is archived or Removed (not on the active roster).

    Manual Directory archive only sets archived_at and may leave outcome="Added".
    Resolve-remove sets outcome="Removed" (usually with archived_at). Both are
    off-roster for UI + classification purposes.
    """
    if person is None:
        return False
    if getattr(person, "archived_at", None) is not None:
        return True
    return (person.outcome or "") == "Removed"


def _directory_match_sort_key(
    item: Tuple[models.ManagerRequest, str],
) -> tuple:
    """Stable ranking for multi-match directory hits.

    Prefer confirmed over potential, on-roster over archived/Removed, Added over
    Removed, then oldest handled_at, then id — never “latest wins”.
    """
    person, classification = item
    confirmed_rank = 0 if classification == "confirmed_duplicate" else 1
    roster_rank = 1 if _directory_is_off_roster(person) else 0
    outcome_rank = 0 if person.outcome == "Added" else 1
    handled = person.handled_at or person.received_at
    handled_key = _norm_dt(handled) if handled else datetime.min.replace(tzinfo=timezone.utc)
    return (confirmed_rank, roster_rank, outcome_rank, handled_key, person.id or "")


def _directory_representative_rank(person: models.ManagerRequest) -> tuple:
    """Prefer the Directory ledger representative: on-roster Added, then newest handled_at."""
    off = 1 if _directory_is_off_roster(person) else 0
    outcome_rank = 0 if (person.outcome or "") == "Added" else 1
    handled = _norm_dt(person.handled_at or person.received_at)
    # Ascending sort → smaller is better; negate timestamp so newest wins.
    return (off, outcome_rank, -handled.timestamp(), person.id or "")


_MATCH_CLASS_RANK = {
    "confirmed_duplicate": 0,
    "potential_duplicate": 1,
}


def _directory_location_key(row: models.ManagerRequest) -> str:
    return (row.person_location or "").strip().lower()


def _directory_email_key(row: models.ManagerRequest) -> str:
    return (row.person_email or "").strip().lower()


def _is_duplicate_directory_update_target(
    left: models.ManagerRequest,
    right: models.ManagerRequest,
    *,
    is_ht: bool,
    is_gll: bool,
) -> bool:
    """True when two Directory rows are stacked copies of the same update target.

    Collapses accidental Add User duplicates (same identity fields).
    Keeps separately selectable rows when location differs OR email differs
    (e.g. two Harry Whitmores at Witney with different emails) so the admin
    radio step can choose which record to update.
    """
    if not same_person_for_partner(
        left, right, is_healthtech=is_ht, is_gll=is_gll
    ):
        return False
    email_l = _directory_email_key(left)
    email_r = _directory_email_key(right)
    if email_l and email_r and email_l != email_r:
        return False
    if is_gll:
        return True
    loc_l = _directory_location_key(left)
    loc_r = _directory_location_key(right)
    if loc_l and loc_r and loc_l != loc_r:
        return False
    return True


def _collapse_directory_matches_to_representatives(
    matches: List[Tuple[models.ManagerRequest, str]],
    *,
    is_ht: bool,
    is_gll: bool,
) -> List[Tuple[models.ManagerRequest, str]]:
    """Collapse stacked Directory copies; keep distinct update targets selectable.

    Repeated Add User cycles can leave many identical handled Added rows. Those
    collapse to one representative (newest active). Rows that still differ as
    update targets (notably different locations) stay separate for the radio UI.
    """
    if len(matches) <= 1:
        return matches

    # Preferred representative first, then greedily keep if not a stacked duplicate.
    ranked = sorted(
        matches,
        key=lambda item: (
            _directory_representative_rank(item[0]),
            _MATCH_CLASS_RANK.get(item[1], 9),
        ),
    )
    kept: List[Tuple[models.ManagerRequest, str]] = []
    for person, cls in ranked:
        prior_idx = next(
            (
                i
                for i, (prior, _) in enumerate(kept)
                if _is_duplicate_directory_update_target(
                    person, prior, is_ht=is_ht, is_gll=is_gll
                )
            ),
            None,
        )
        if prior_idx is None:
            kept.append((person, cls))
            continue
        prior, prior_cls = kept[prior_idx]
        if _MATCH_CLASS_RANK.get(cls, 9) < _MATCH_CLASS_RANK.get(prior_cls, 9):
            kept[prior_idx] = (prior, cls)

    kept.sort(key=_directory_match_sort_key)
    return kept


def _find_all_directory_matches(
    db: Session,
    req_person: schemas.PersonInfo,
    dir_candidates: List[models.ManagerRequest],
    *,
    req_id: str,
    is_ht: bool,
    is_gll: bool,
    dismissed_set: Optional[Set[Tuple[str, str]]] = None,
) -> List[Tuple[models.ManagerRequest, str]]:
    """Return directory matches; collapse stacked copies, keep distinct targets."""
    matches: List[Tuple[models.ManagerRequest, str]] = []
    for dir_cand in dir_candidates:
        if are_requests_dismissed(db, req_id, dir_cand.id, dismissed_set=dismissed_set):
            continue
        classification, _ = match_classification_for_partner(
            req_person,
            person_from_model(dir_cand),
            is_healthtech=is_ht,
            is_gll=is_gll,
        )
        if classification:
            matches.append((dir_cand, classification))
    return _collapse_directory_matches_to_representatives(
        matches, is_ht=is_ht, is_gll=is_gll
    )


def _classification_from_directory_matches(
    matches: List[Tuple[models.ManagerRequest, str]],
    *,
    has_peer_match: bool,
) -> Optional[str]:
    """Derive group classification from the full set of directory matches."""
    if not matches:
        return None

    has_confirmed_active = any(
        cls == "confirmed_duplicate"
        and person.outcome == "Added"
        and not _directory_is_off_roster(person)
        for person, cls in matches
    )
    has_confirmed_off_roster = any(
        cls == "confirmed_duplicate" and _directory_is_off_roster(person)
        for person, cls in matches
    )
    has_active = any(
        person.outcome == "Added" and not _directory_is_off_roster(person)
        for person, _ in matches
    )
    has_off_roster = any(_directory_is_off_roster(person) for person, _ in matches)

    if has_peer_match:
        if has_active or has_confirmed_active:
            return "already_exists_conflict"
        if has_off_roster or has_confirmed_off_roster:
            return "already_removed_conflict"
        return "already_exists_conflict"

    if has_confirmed_active:
        return "already_exists"
    if has_confirmed_off_roster and not has_active:
        return "already_removed"
    # Potential (or mixed potential) against Directory
    return "potential_duplicate"


def find_all_directory_matches_for_requests(
    db: Session,
    requests: List[models.ManagerRequest],
    *,
    dismissed_set: Optional[Set[Tuple[str, str]]] = None,
) -> List[models.ManagerRequest]:
    """Union of all directory records that match any of *requests* (partner-scoped).

    Used by group-detail serialization so the UI can show every equally valid
    Directory match, not only group.directory_person_id.
    """
    if not requests:
        return []

    seen: dict[str, models.ManagerRequest] = {}
    for req in requests:
        if not req:
            continue
        is_ht = is_healthtech_from_request(db, req)
        is_gll = is_gll_from_request(db, req)
        candidates = _directory_candidates(db, req)
        matches = _find_all_directory_matches(
            db,
            person_from_model(req),
            candidates,
            req_id=req.id,
            is_ht=is_ht,
            is_gll=is_gll,
            dismissed_set=dismissed_set,
        )
        for person, _cls in matches:
            if person.id and person.id not in seen:
                seen[person.id] = person

    return sorted(
        seen.values(),
        key=lambda p: _directory_match_sort_key((p, "potential_duplicate")),
    )


def eligible_directory_person_ids_for_group(
    db: Session,
    group: models.DuplicateGroup,
    *,
    members: Optional[List[models.ManagerRequest]] = None,
    dismissed_set: Optional[Set[Tuple[str, str]]] = None,
) -> Set[str]:
    """IDs an admin may explicitly select for Add/Remove-and-Update on this group.

    Only Added/Active (on-roster) Directory rows are eligible. Archived/Removed
    matches are never selectable — an incoming Add against archived must use the
    normal new-Add path instead of updating/restoring the archive.

    Candidates come from the stored primary, persisted multi-match ids, and a live
    re-scan of Directory matches for current open members.
    """
    ids: Set[str] = set()
    if group.directory_person_id:
        ids.add(group.directory_person_id)
    meta = group.resolution_metadata if isinstance(group.resolution_metadata, dict) else {}
    for mid in meta.get("matched_directory_person_ids") or []:
        if mid:
            ids.add(str(mid))
    if members is None:
        members = get_group_members(db, group.id)
    if dismissed_set is None:
        dismissed_set = get_all_dismissed_pairs(db)
    for row in find_all_directory_matches_for_requests(
        db, members, dismissed_set=dismissed_set
    ):
        if row.id:
            ids.add(row.id)
    if not ids:
        return set()
    rows = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id.in_(list(ids)))
        .all()
    )
    active = [
        row
        for row in rows
        if row.id
        and row.status == "handled"
        and (row.outcome or "") == "Added"
        and not _directory_is_off_roster(row)
    ]
    if not active:
        return set()
    # Collapse duplicate Directory identities (same rule as match discovery / ledger).
    partner_id = group.partner_id or (active[0].partner_id if active else None)
    is_ht = False
    is_gll = False
    if members:
        sample = members[0]
        is_ht = is_healthtech_from_request(db, sample)
        is_gll = is_gll_from_request(db, sample)
    elif partner_id:
        is_ht = is_healthtech_partner(db, partner_id)
        is_gll = is_gll_partner(db, partner_id)
    collapsed = _collapse_directory_matches_to_representatives(
        [(row, "potential_duplicate") for row in active],
        is_ht=is_ht,
        is_gll=is_gll,
    )
    return {person.id for person, _ in collapsed if person.id}


def load_eligible_directory_person(
    db: Session,
    group: models.DuplicateGroup,
    directory_person_id: str,
    *,
    members: Optional[List[models.ManagerRequest]] = None,
) -> models.ManagerRequest:
    """Load *directory_person_id* if it is still an eligible active Directory match.

    Raises ValueError with a stable message when the id is missing, archived/
    Removed, or no longer eligible for this group's members.
    """
    if not directory_person_id:
        raise ValueError("directoryPersonId is required.")
    eligible = eligible_directory_person_ids_for_group(db, group, members=members)
    if directory_person_id not in eligible:
        raise ValueError(
            "That Directory record is no longer eligible for this request. "
            "Archived or removed records cannot be selected. "
            "Refresh the page and choose again."
        )
    dir_person = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id == directory_person_id)
        .first()
    )
    if not dir_person or dir_person.status != "handled":
        raise ValueError(
            "That Directory record is no longer available. "
            "Refresh the page and choose again."
        )
    if _directory_is_off_roster(dir_person) or (dir_person.outcome or "") != "Added":
        raise ValueError(
            "Archived or removed Directory records cannot be updated or restored "
            "by an incoming request. Use Add to Directory to create a new active record."
        )
    return dir_person


def is_request_dismissed_from_group(db: Session, request_id: str, group_id: str) -> bool:
    """True if request_id has been explicitly dismissed from group_id."""
    if not request_id or not group_id:
        return False
    row = db.query(models.DismissedGroupMatch).filter(
        models.DismissedGroupMatch.request_id == request_id,
        models.DismissedGroupMatch.group_id == group_id
    ).first()
    return row is not None


# ---------------------------------------------------------------------------
# Core grouping entry point
# ---------------------------------------------------------------------------


def process_request_grouping(
    db: Session,
    req: models.ManagerRequest,
    *,
    pending_candidates: Optional[List[models.ManagerRequest]] = None,
    directory_candidates: Optional[List[models.ManagerRequest]] = None,
    dismissed_set: Optional[Set[Tuple[str, str]]] = None,
) -> Optional[models.DuplicateGroup]:
    """Find or create a DuplicateGroup for *req*, preserving all original request data."""
    from app.duplicate_matching import get_all_rejected_nickname_pairs
    from app.nickname_match import rejected_nickname_pairs_scope

    with rejected_nickname_pairs_scope(get_all_rejected_nickname_pairs(db)):
        return _process_request_grouping_impl(
            db,
            req,
            pending_candidates=pending_candidates,
            directory_candidates=directory_candidates,
            dismissed_set=dismissed_set,
        )


def _process_request_grouping_impl(
    db: Session,
    req: models.ManagerRequest,
    *,
    pending_candidates: Optional[List[models.ManagerRequest]] = None,
    directory_candidates: Optional[List[models.ManagerRequest]] = None,
    dismissed_set: Optional[Set[Tuple[str, str]]] = None,
) -> Optional[models.DuplicateGroup]:
    """Inner grouping body (runs under rejected-nickname scope)."""
    if not req or req.status != "new":
        return None

    # If already grouped (e.g., re-evaluated), just sync and return.
    if req.duplicate_group_id:
        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == req.duplicate_group_id)
            .first()
        )
        if group:
            _sync_group_representative_and_tags(db, group)
            return group

    req_person = person_from_model(req)

    # Detect whether this request belongs to the HealthTech or GLL partner so we
    # use the correct matching logic throughout this grouping run.
    is_ht = is_healthtech_from_request(db, req)
    is_gll = is_gll_from_request(db, req)

    # ── Step 1: scan pending new requests for a match ───────────────────────
    if pending_candidates is not None:
        p_cands = [
            c for c in pending_candidates
            if c.id != req.id and c.status == "new" and (not req.partner_id or c.partner_id == req.partner_id)
        ]
    else:
        p_cands = _pending_candidates(db, req, exclude_id=req.id)

    # Evaluate pending matches grouped by duplicate_group_id
    from collections import defaultdict
    groups = defaultdict(list)
    for c in p_cands:
        group_key = c.duplicate_group_id if c.duplicate_group_id else f"standalone_{c.id}"
        groups[group_key].append(c)

    best_group_key = None
    best_group_score = -1.0
    best_group_classification = None
    best_group_match_req = None

    for group_key, members in groups.items():
        if group_key.startswith("dup-grp-"):
            if is_request_dismissed_from_group(db, req.id, group_key):
                continue

        group_max_score = -1.0
        group_best_classification = None
        group_best_member = None

        for cand in members:
            if are_requests_dismissed(db, req.id, cand.id, dismissed_set=dismissed_set):
                continue
            
            classification, score = match_classification_for_partner(req_person, person_from_model(cand), is_healthtech=is_ht, is_gll=is_gll)
            if classification:
                if group_best_classification != "confirmed_duplicate" and classification == "confirmed_duplicate":
                    group_best_classification = classification
                    group_max_score = score
                    group_best_member = cand
                elif classification == group_best_classification:
                    if score > group_max_score:
                        group_max_score = score
                        group_best_member = cand
                elif group_best_classification is None:
                    group_best_classification = classification
                    group_max_score = score
                    group_best_member = cand

        if group_best_classification:
            is_better = False
            if best_group_classification is None:
                is_better = True
            elif group_best_classification == "confirmed_duplicate" and best_group_classification != "confirmed_duplicate":
                is_better = True
            elif group_best_classification == best_group_classification:
                if group_max_score > best_group_score:
                    is_better = True
                elif group_max_score == best_group_score:
                    ts_group = group_best_member.handled_at or group_best_member.received_at
                    ts_best = best_group_match_req.handled_at or best_group_match_req.received_at
                    if ts_group > ts_best:
                        is_better = True
            
            if is_better:
                best_group_key = group_key
                best_group_score = group_max_score
                best_group_classification = group_best_classification
                best_group_match_req = group_best_member

    best_match_req = best_group_match_req

    # ── Step 2: scan directory for ALL qualifying matches (no early exit) ───
    if directory_candidates is not None:
        dir_candidates = [
            c for c in directory_candidates
            if c.status == "handled" and c.outcome in ("Added", "Removed") and (not req.partner_id or c.partner_id == req.partner_id)
        ]
    else:
        dir_candidates = _directory_candidates(db, req)

    dir_matches = _find_all_directory_matches(
        db,
        req_person,
        dir_candidates,
        req_id=req.id,
        is_ht=is_ht,
        is_gll=is_gll,
        dismissed_set=dismissed_set,
    )
    dir_match_person = dir_matches[0][0] if dir_matches else None

    # ── Step 3: determine final classification ──────────────────────────────
    final_classification = _classification_from_directory_matches(
        dir_matches,
        has_peer_match=bool(best_match_req),
    )
    if final_classification is None:
        if best_match_req:
            final_classification = best_group_classification
        else:
            return None  # No match found — no group needed

    # Persist every matched Directory id for later detail views / audit.
    matched_directory_ids = [person.id for person, _ in dir_matches if person.id]

    # ── Step 4: join an existing group or create a new one ──────────────────

    # If the best-matching pending request is already in a group, join that group.
    if best_match_req and best_match_req.duplicate_group_id:
        # Same lock as merge_group_peers — waits out an in-flight merge so the
        # representative sync below sees its result.
        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == best_match_req.duplicate_group_id)
            .with_for_update()
            .populate_existing()
            .first()
        )
        if group:
            req.duplicate_group_id = group.id
            # Upgrade classification if this new request makes it more severe.
            upgraded = _best_classification(group.classification, final_classification)
            if upgraded != group.classification:
                group.classification = upgraded
            if dir_match_person:
                group.directory_person_id = dir_match_person.id
            if matched_directory_ids:
                meta = dict(group.resolution_metadata or {})
                existing_ids = list(meta.get("matched_directory_person_ids") or [])
                merged = list(dict.fromkeys([*existing_ids, *matched_directory_ids]))
                meta["matched_directory_person_ids"] = merged
                group.resolution_metadata = meta
                flag_modified(group, "resolution_metadata")
            # Absorb any other ungrouped candidates into this group too.
            _absorb_ungrouped_matches(
                db,
                group,
                req_person,
                exclude_id=req.id,
                ungrouped_candidates=p_cands,
                dismissed_set=dismissed_set,
                is_healthtech=is_ht,
                is_gll=is_gll,
            )
            members = [req] + [c for c in p_cands if c.duplicate_group_id == group.id]
            _sync_group_representative_and_tags(db, group, member_requests=members)
            # db.flush()
            return group

    # Create a brand-new group.
    group = models.DuplicateGroup(
        id=_new_group_id(),
        partner_id=req.partner_id,
        classification=final_classification,
        status="active",
        created_at=datetime.now(timezone.utc),
        directory_person_id=dir_match_person.id if dir_match_person else None,
        representative_request_id=req.id,
        resolution_metadata=(
            {"matched_directory_person_ids": matched_directory_ids}
            if matched_directory_ids
            else None
        ),
    )
    db.add(group)
    # db.flush()

    req.duplicate_group_id = group.id

    if best_match_req:
        best_match_req.duplicate_group_id = group.id

    # Absorb any remaining ungrouped candidates that also match.
    _absorb_ungrouped_matches(
        db, group, req_person, exclude_id=req.id, ungrouped_candidates=p_cands, dismissed_set=dismissed_set, is_healthtech=is_ht, is_gll=is_gll
    )

    members = [req] + [c for c in p_cands if c.duplicate_group_id == group.id]
    if best_match_req and best_match_req not in members:
        members.append(best_match_req)
    _sync_group_representative_and_tags(db, group, member_requests=members)
    # db.flush()
    return group


def _absorb_ungrouped_matches(
    db: Session,
    group: models.DuplicateGroup,
    req_person: schemas.PersonInfo,
    *,
    exclude_id: Optional[str] = None,
    ungrouped_candidates: Optional[List[models.ManagerRequest]] = None,
    dismissed_set: Optional[Set[Tuple[str, str]]] = None,
    is_healthtech: bool = False,
    is_gll: bool = False,
) -> None:
    """Pull still-ungrouped pending requests that match *req_person* into *group*.

    Never reunites requests that were separated via Not the Same Person: a
    candidate is skipped when dismissed against the incoming request, against
    this group id, OR against any member already in the group.
    """
    if ungrouped_candidates is not None:
        candidates = [
            c for c in ungrouped_candidates
            if c.status == "new"
            and not c.duplicate_group_id
            and (not group.partner_id or c.partner_id == group.partner_id)
            and (not exclude_id or c.id != exclude_id)
        ]
    else:
        ungrouped_q = db.query(models.ManagerRequest).filter(
            models.ManagerRequest.status == "new",
            models.ManagerRequest.duplicate_group_id.is_(None),
        )
        if group.partner_id:
            ungrouped_q = ungrouped_q.filter(
                models.ManagerRequest.partner_id == group.partner_id
            )
        if exclude_id:
            ungrouped_q = ungrouped_q.filter(models.ManagerRequest.id != exclude_id)
        candidates = ungrouped_q.limit(100).all()

    # Flush so in-memory assignments (incoming + best match) are visible to the
    # member query even when the session has autoflush disabled.
    db.flush()

    # Members already assigned to this group (including those just attached).
    member_ids: Set[str] = {
        m.id
        for m in db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.duplicate_group_id == group.id,
            models.ManagerRequest.status == "new",
        )
        .all()
        if m.id
    }
    if exclude_id:
        member_ids.add(exclude_id)

    # Pre-score which ungrouped candidates match the probe person so we can
    # honour sibling Not-the-Same-Person dismissals (A dismissed B, both match
    # the group — neither should be absorbed even if the original peer left).
    matching_ungrouped_ids: Set[str] = set()
    cand_classifications: dict = {}
    for cand in candidates:
        if not cand.id:
            continue
        classification, _score = match_classification_for_partner(
            req_person,
            person_from_model(cand),
            is_healthtech=is_healthtech,
            is_gll=is_gll,
        )
        if classification:
            matching_ungrouped_ids.add(cand.id)
            cand_classifications[cand.id] = classification

    for cand in candidates:
        if not cand.id:
            continue
        if are_requests_dismissed(db, exclude_id or "", cand.id, dismissed_set=dismissed_set):
            continue
        if is_request_dismissed_from_group(db, cand.id, group.id):
            continue
        # Critical: respect pairwise Not-the-Same-Person dismissals vs anyone
        # already in the group (not only vs the newly arriving request).
        if any(
            are_requests_dismissed(db, cand.id, mid, dismissed_set=dismissed_set)
            for mid in member_ids
            if mid != cand.id
        ):
            continue
        # Sibling lookalike barrier: dismissed against another ungrouped match.
        if any(
            are_requests_dismissed(db, cand.id, other_id, dismissed_set=dismissed_set)
            for other_id in matching_ungrouped_ids
            if other_id != cand.id
        ):
            continue

        classification = cand_classifications.get(cand.id)
        if classification:
            cand.duplicate_group_id = group.id
            member_ids.add(cand.id)
            matching_ungrouped_ids.discard(cand.id)
            upgraded = _best_classification(group.classification, classification)
            if upgraded != group.classification:
                group.classification = upgraded


def find_separated_lookalike_requests(
    db: Session,
    group: models.DuplicateGroup,
    members: List[models.ManagerRequest],
    *,
    dismissed_set: Optional[Set[Tuple[str, str]]] = None,
    limit: int = 20,
) -> List[models.ManagerRequest]:
    """Open requests that match this group's newest member but stay outside the group.

    Typical case: previously unlinked ("Not the Same Person") lookalikes that a
    *new* request also matches. Used for the admin warning with hyperlinks.

    A candidate counts when it matches the probe (newest member) AND is blocked
    from this group by:
      * a pairwise dismissal vs an older current member, or
      * a group-level dismissal for this group id, or
      * a pairwise dismissal vs another open request that also matches the probe
        (sibling lookalike cohort), or
      * (sole open member only) a pairwise dismissal vs the probe itself —
        covers Merge inheriting Denver→survivor Not-the-Same-Person barriers.

    Hide when dismissed against the probe while older members remain — that is
    the "just unlinked from this group" case and must not offer Attach back.
    """
    if not members:
        return []

    probe = max(members, key=lambda m: _norm_dt(m.received_at))
    probe_person = person_from_model(probe)
    is_ht = is_healthtech_from_request(db, probe)
    is_gll = is_gll_from_request(db, probe)
    member_ids = {m.id for m in members if m.id}
    older_ids = member_ids - {probe.id}

    q = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.status == "new",
    )
    if member_ids:
        q = q.filter(models.ManagerRequest.id.notin_(list(member_ids)))
    if group.partner_id:
        q = q.filter(models.ManagerRequest.partner_id == group.partner_id)
    candidates = q.order_by(models.ManagerRequest.received_at.desc()).limit(80).all()

    if dismissed_set is None:
        dismissed_set = get_all_dismissed_pairs(db)

    matching: List[models.ManagerRequest] = []
    for cand in candidates:
        if not cand.id or cand.id in member_ids:
            continue
        classification, _ = match_classification_for_partner(
            probe_person,
            person_from_model(cand),
            is_healthtech=is_ht,
            is_gll=is_gll,
        )
        if classification:
            matching.append(cand)

    matching_ids = {c.id for c in matching}

    out: List[models.ManagerRequest] = []
    for cand in matching:
        dismissed_vs_probe = are_requests_dismissed(
            db, cand.id, probe.id, dismissed_set=dismissed_set
        )
        # Just separated from this group's newest peer while older members remain
        # — do not offer "attach back" on the same group.
        if dismissed_vs_probe and older_ids:
            continue

        blocked = any(
            are_requests_dismissed(db, cand.id, mid, dismissed_set=dismissed_set)
            for mid in older_ids
        ) or is_request_dismissed_from_group(db, cand.id, group.id)
        if not blocked:
            # Sibling lookalike: dismissed against another open match outside this group.
            blocked = any(
                are_requests_dismissed(db, cand.id, other_id, dismissed_set=dismissed_set)
                for other_id in matching_ids
                if other_id != cand.id
            )
        if not blocked and dismissed_vs_probe and not older_ids:
            # Sole open member (post-Merge): inherited Not-the-Same-Person vs probe
            # still counts as the attachable lookalike barrier.
            blocked = True
        if not blocked:
            continue
        out.append(cand)
        if len(out) >= limit:
            break
    return out


def _clear_dismissed_pair(db: Session, request_id_a: str, request_id_b: str) -> None:
    """Remove Not-the-Same-Person dismissals between two requests (both orderings)."""
    if not request_id_a or not request_id_b or request_id_a == request_id_b:
        return
    db.query(models.DismissedDuplicateMatch).filter(
        or_(
            and_(
                models.DismissedDuplicateMatch.request_id_1 == request_id_a,
                models.DismissedDuplicateMatch.request_id_2 == request_id_b,
            ),
            and_(
                models.DismissedDuplicateMatch.request_id_1 == request_id_b,
                models.DismissedDuplicateMatch.request_id_2 == request_id_a,
            ),
        )
    ).delete(synchronize_session=False)


def _clear_dismissed_group(db: Session, request_id: str, group_id: str) -> None:
    """Remove a request↔group dismissal so the request may join that group again."""
    if not request_id or not group_id:
        return
    db.query(models.DismissedGroupMatch).filter(
        models.DismissedGroupMatch.request_id == request_id,
        models.DismissedGroupMatch.group_id == group_id,
    ).delete(synchronize_session=False)


def reattach_to_lookalike(
    db: Session,
    group_id: str,
    target_request_id: str,
    *,
    admin_id: Optional[str] = None,
    source_request_id: Optional[str] = None,
) -> Optional[dict]:
    """Move one open member of this group onto a separated lookalike request.

    Preconditions:
      * Source group is active with at least one status=new member.
      * source_request_id names that member when the group has multiple; with a
        single member it may be omitted.
      * target_request_id is an open lookalike that was separated via Not the
        same person (returned by find_separated_lookalike_requests).

    Effects:
      * Clears pairwise dismissal only between the chosen source and the target.
      * Leaves dismissals vs other lookalikes / remaining peers intact.
      * Joins the target's existing group, or creates a new two-member group.
      * Dismisses the source group only when no open members remain.

    Returns
    ``{sourceRequestId, targetRequestId, newGroupId, previousGroupId,
    previousGroupDismissed}`` or None when the operation is not allowed.
    """
    del admin_id  # reserved for audit; dismissals cleared without admin stamp

    group = (
        db.query(models.DuplicateGroup)
        .filter(models.DuplicateGroup.id == group_id)
        .first()
    )
    if not group or group.status != "active":
        return None

    members = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.duplicate_group_id == group.id,
            models.ManagerRequest.status == "new",
        )
        .all()
    )
    if not members:
        return None

    if len(members) == 1:
        source = members[0]
        if source_request_id and source.id != source_request_id:
            return None
    else:
        if not source_request_id:
            return None
        source = next((m for m in members if m.id == source_request_id), None)
        if source is None:
            return None

    if not source.id or source.id == target_request_id:
        return None

    target = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id == target_request_id)
        .first()
    )
    if not target or target.status != "new":
        return None
    if group.partner_id and target.partner_id and target.partner_id != group.partner_id:
        return None

    lookalikes = find_separated_lookalike_requests(db, group, members)
    if not any(r.id == target.id for r in lookalikes):
        return None

    is_ht = is_healthtech_from_request(db, source)
    is_gll = is_gll_from_request(db, source)
    classification, _ = match_classification_for_partner(
        person_from_model(source),
        person_from_model(target),
        is_healthtech=is_ht,
        is_gll=is_gll,
    )
    if not classification:
        return None

    now = datetime.now(timezone.utc)

    # Allow this pair to share a group again; leave other lookalike dismissals.
    _clear_dismissed_pair(db, source.id, target.id)

    destination: Optional[models.DuplicateGroup] = None
    if target.duplicate_group_id:
        destination = (
            db.query(models.DuplicateGroup)
            .filter(
                models.DuplicateGroup.id == target.duplicate_group_id,
                models.DuplicateGroup.status == "active",
            )
            .first()
        )

    if destination is None:
        destination = models.DuplicateGroup(
            id=_new_group_id(),
            partner_id=group.partner_id or target.partner_id,
            classification=classification,
            status="active",
            created_at=now,
            directory_person_id=None,
            representative_request_id=None,
        )
        db.add(destination)
        db.flush()
        target.duplicate_group_id = destination.id
    else:
        upgraded = _best_classification(destination.classification, classification)
        if upgraded != destination.classification:
            destination.classification = upgraded

    _clear_dismissed_group(db, source.id, destination.id)

    source.duplicate_group_id = destination.id
    db.flush()

    remaining = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.duplicate_group_id == group.id,
            models.ManagerRequest.status == "new",
        )
        .all()
    )
    previous_dismissed = len(remaining) == 0
    if previous_dismissed:
        # Only when the source group is emptied may the target rejoin that id.
        _clear_dismissed_group(db, target.id, group.id)
        group.status = "dismissed"
        group.resolved_at = now
        group.representative_request_id = None
    else:
        _sync_group_representative_and_tags(db, group, member_requests=remaining)

    dest_members = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.duplicate_group_id == destination.id,
            models.ManagerRequest.status == "new",
        )
        .all()
    )
    _sync_group_representative_and_tags(db, destination, member_requests=dest_members)

    return {
        "sourceRequestId": source.id,
        "targetRequestId": target.id,
        "newGroupId": destination.id,
        "previousGroupId": group_id,
        "previousGroupDismissed": previous_dismissed,
    }


# ---------------------------------------------------------------------------
# Representative + tag sync
# ---------------------------------------------------------------------------


def _sync_group_representative_and_tags(
    db: Session,
    group: models.DuplicateGroup,
    member_requests: Optional[List[models.ManagerRequest]] = None,
) -> None:
    """Set representative to latest member; apply correct duplicate tags to it.

    The representative's peer-duplicate tag is determined by comparing it against
    its IMMEDIATE PREDECESSOR (second-latest member), NOT by the group's
    historical worst-case classification.  This ensures that a request whose
    first name differs from the prior representative (e.g. "stevenson" vs
    "steve") is correctly tagged as potential_duplicate even when the group's
    classification field is confirmed_duplicate due to an earlier pair.

    Tags are only written to the REPRESENTATIVE request.  Older non-representative
    group members keep their original tags for audit fidelity.
    """
    # Always fetch flushed DB members to guarantee we don't miss any older ones
    db_members = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.duplicate_group_id == group.id,
            models.ManagerRequest.status == "new",
        )
        .all()
    )

    # Merge DB members with explicitly passed ones (which might not be flushed yet)
    all_members = {m.id: m for m in db_members if m.status == "new"}
    if member_requests:
        for m in member_requests:
            if m.status == "new":
                all_members[m.id] = m

    members = sorted(
        all_members.values(),
        key=lambda r: (
            _norm_dt(r.received_at),
            r.id or "",
        ),
        reverse=True,
    )

    if not members:
        group.representative_request_id = None
        return

    latest_req = members[0]
    group.representative_request_id = latest_req.id

    # ── Determine which peer-duplicate tag to apply to the representative ──────
    # Compare the representative against its immediate predecessor so we tag it
    # with its ACTUAL relationship, not the group's historical worst-case.
    tags_to_add: List[str] = []

    if len(members) >= 2:
        predecessor = members[1]
        is_ht_group = is_healthtech_from_request(db, latest_req)
        is_gll_group = is_gll_from_request(db, latest_req)
        result = match_classification_for_partner(
            person_from_model(latest_req),
            person_from_model(predecessor),
            is_healthtech=is_ht_group,
            is_gll=is_gll_group,
        )
        # match_classification_for_partner returns bare None when last names are missing,
        # or (classification, score) otherwise.
        if isinstance(result, tuple):
            rep_classification, _ = result
            if rep_classification == "confirmed_duplicate":
                tags_to_add.append(TAG_CONFIRMED_DUPLICATE)
            elif rep_classification == "potential_duplicate":
                tags_to_add.append(TAG_POTENTIAL_DUPLICATE)
        # else: no last name on one side — no peer tag

    # ── Directory tag is orthogonal to the peer relationship ───────────────────
    if group.directory_person_id:
        dir_person = db.query(models.ManagerRequest).filter_by(id=group.directory_person_id).first()
        if dir_person:
            is_ht_group = is_healthtech_from_request(db, latest_req)
            is_gll_group = is_gll_from_request(db, latest_req)
            result = match_classification_for_partner(
                person_from_model(latest_req),
                person_from_model(dir_person),
                is_healthtech=is_ht_group,
                is_gll=is_gll_group,
            )
            dir_classification = None
            if isinstance(result, tuple):
                dir_classification, _ = result

            if _directory_is_off_roster(dir_person):
                # Archived / Removed Directory — never label as active "Exists in Directory".
                if dir_classification == "confirmed_duplicate":
                    tags_to_add.append(TAG_ALREADY_REMOVED)
                elif dir_classification == "potential_duplicate":
                    # Keep potential visible AND signal the archived Directory link.
                    tags_to_add.append(TAG_POTENTIAL_DUPLICATE)
                    tags_to_add.append(TAG_ALREADY_REMOVED)
            else:
                if dir_classification == "confirmed_duplicate":
                    tags_to_add.append(TAG_ALREADY_EXISTS)
                elif dir_classification == "potential_duplicate":
                    if TAG_POTENTIAL_DUPLICATE not in tags_to_add:
                        tags_to_add.append(TAG_POTENTIAL_DUPLICATE)

    # Strip any stale peer-duplicate tags before applying the freshly computed one
    # so we never accumulate both confirmed duplicate and potential duplicate.
    stale_peer_tags = {TAG_CONFIRMED_DUPLICATE, TAG_POTENTIAL_DUPLICATE, TAG_ALREADY_EXISTS, TAG_ALREADY_REMOVED}
    latest_req.tags = [t for t in (latest_req.tags or []) if t not in stale_peer_tags]
    if tags_to_add:
        latest_req.tags = merge_tags(latest_req.tags, tags_to_add)
    flag_modified(latest_req, "tags")


# ---------------------------------------------------------------------------
# Admin unlink / false-positive dismissal
# ---------------------------------------------------------------------------


def unlink_duplicate_members(
    db: Session,
    group_id: str,
    request_id_1: str,
    request_id_2: str,
    admin_id: Optional[str] = None,
    strict_single: bool = False,
) -> Optional[dict]:
    """Unlink request_id_2 from its group (false-positive vs request_id_1).

    Confirmed-duplicate siblings of request_id_2 leave with it and are placed
    in a new active group together. Potential-only siblings stay in the original
    group. Persists dismissed pairs / group dismissals so they do not rejoin.

    Returns ``{"unlinkedIds": [...], "newGroupId": str|None}`` or None on failure.

    NOTE: Does NOT call db.commit() — the calling router is responsible for
    committing so this function is consistent with all other service functions.
    """
    group = (
        db.query(models.DuplicateGroup)
        .filter(models.DuplicateGroup.id == group_id)
        .first()
    )
    if not group:
        return None

    req1 = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id == request_id_1)
        .first()
    )
    req2 = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id == request_id_2)
        .first()
    )

    if not req1 or not req2:
        return None

    now = datetime.now(timezone.utc)
    admin_uuid = admin_id if admin_id and admin_id != "dev-bypass" else None

    # Cohort = target + any confirmed-duplicate siblings still in this group.
    # Those leave together as their own duplicate cluster.
    cohort: List[models.ManagerRequest] = [req2]
    if not strict_single:
        siblings = (
            db.query(models.ManagerRequest)
            .filter(
                models.ManagerRequest.duplicate_group_id == group.id,
                models.ManagerRequest.id != req2.id,
                models.ManagerRequest.id != req1.id,
            )
            .all()
        )
        req2_person = person_from_model(req2)
        is_ht_grp  = is_healthtech_from_request(db, req2)
        is_gll_grp = is_gll_from_request(db, req2)
        for sibling in siblings:
            classification, _ = match_classification_for_partner(
                req2_person, person_from_model(sibling),
                is_healthtech=is_ht_grp, is_gll=is_gll_grp,
            )
            if classification == "confirmed_duplicate":
                cohort.append(sibling)

    cohort_ids = {m.id for m in cohort}

    # Everyone else currently in the group — dismiss against ALL of them so
    # later absorb cannot reunite Not-the-Same-Person peers via a third request.
    other_q = db.query(models.ManagerRequest).filter(
        models.ManagerRequest.duplicate_group_id == group.id,
    )
    if cohort_ids:
        other_q = other_q.filter(models.ManagerRequest.id.notin_(list(cohort_ids)))
    other_members = other_q.all()
    dismiss_against_ids = {m.id for m in other_members if m.id}
    dismiss_against_ids.add(request_id_1)
    if group.directory_person_id:
        dismiss_against_ids.add(group.directory_person_id)

    for member in cohort:
        for other_id in dismiss_against_ids:
            if not other_id or other_id == member.id:
                continue
            if not are_requests_dismissed(db, other_id, member.id):
                db.add(
                    models.DismissedDuplicateMatch(
                        id=f"dism-{uuid.uuid4().hex[:12]}",
                        request_id_1=other_id,
                        request_id_2=member.id,
                        dismissed_by_admin_id=admin_uuid,
                        created_at=now,
                    )
                )
        db.add(
            models.DismissedGroupMatch(
                id=f"dism-grp-{uuid.uuid4().hex[:12]}",
                request_id=member.id,
                group_id=group_id,
                dismissed_by_admin_id=admin_uuid,
                created_at=now,
            )
        )
        member.duplicate_group_id = None
        _clear_duplicate_tags(member)

    db.flush()

    new_group_id = None
    if len(cohort) >= 2:
        new_group = models.DuplicateGroup(
            id=_new_group_id(),
            partner_id=group.partner_id,
            classification="confirmed_duplicate",
            status="active",
            created_at=now,
            directory_person_id=None,
            representative_request_id=None,
        )
        db.add(new_group)
        db.flush()
        for member in cohort:
            member.duplicate_group_id = new_group.id
        _sync_group_representative_and_tags(db, new_group, member_requests=cohort)
        new_group_id = new_group.id

    # Re-evaluate remaining members of the original group.
    remaining = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.duplicate_group_id == group.id)
        .all()
    )

    if len(remaining) == 0:
        group.status = "dismissed"
        group.resolved_at = now
    elif len(remaining) == 1 and not group.directory_person_id:
        remaining[0].duplicate_group_id = None
        _clear_duplicate_tags(remaining[0])
        group.status = "dismissed"
        group.resolved_at = now
    else:
        dir_match = False
        peer_match_class = None

        if group.directory_person_id:
            dir_person = (
                db.query(models.ManagerRequest)
                .filter(models.ManagerRequest.id == group.directory_person_id)
                .first()
            )
            if dir_person:
                is_ht_remain  = is_healthtech_from_request(db, remaining[0]) if remaining else False
                is_gll_remain = is_gll_from_request(db, remaining[0]) if remaining else False
                for m in remaining:
                    if not are_requests_dismissed(db, m.id, dir_person.id):
                        c, _ = match_classification_for_partner(
                            person_from_model(m), person_from_model(dir_person),
                            is_healthtech=is_ht_remain, is_gll=is_gll_remain,
                        )
                        if c:
                            dir_match = True
                            break

        is_ht_remain  = is_healthtech_from_request(db, remaining[0]) if remaining else False
        is_gll_remain = is_gll_from_request(db, remaining[0]) if remaining else False
        for i in range(len(remaining)):
            for j in range(i + 1, len(remaining)):
                if not are_requests_dismissed(db, remaining[i].id, remaining[j].id):
                    c, _ = match_classification_for_partner(
                        person_from_model(remaining[i]),
                        person_from_model(remaining[j]),
                        is_healthtech=is_ht_remain, is_gll=is_gll_remain,
                    )
                    if c:
                        peer_match_class = _best_classification(peer_match_class, c)

        if dir_match and peer_match_class:
            new_class = "already_exists_conflict"
        elif dir_match:
            new_class = "already_exists"
        elif peer_match_class:
            new_class = peer_match_class
        else:
            new_class = None

        if not new_class:
            for m in remaining:
                m.duplicate_group_id = None
                _clear_duplicate_tags(m)
            group.status = "dismissed"
            group.resolved_at = now
        else:
            group.classification = new_class
            for m in remaining:
                _clear_duplicate_tags(m)
            _sync_group_representative_and_tags(db, group, member_requests=remaining)

    db.flush()
    return {
        "unlinkedIds": list(cohort_ids),
        "newGroupId": new_group_id,
    }


def get_dismiss_impact(
    db: Session,
    request_id: str,
) -> dict:
    """Preview which group siblings would also be deleted with this request.

    Confirmed-match siblings are deleted with the target. Potential-only siblings
    are left for separate review.
    """
    req = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id == request_id)
        .first()
    )
    if not req:
        return {
            "requestId": request_id,
            "confirmedSiblingIds": [],
            "potentialSiblingIds": [],
            "confirmedSiblingCount": 0,
            "potentialSiblingCount": 0,
        }

    confirmed_ids: List[str] = []
    potential_ids: List[str] = []
    if req.duplicate_group_id and req.status == "new":
        members = (
            db.query(models.ManagerRequest)
            .filter(
                models.ManagerRequest.duplicate_group_id == req.duplicate_group_id,
                models.ManagerRequest.status == "new",
                models.ManagerRequest.id != req.id,
            )
            .all()
        )
        target_person = person_from_model(req)
        is_ht_req = is_healthtech_from_request(db, req)
        for member in members:
            classification, _ = match_classification_for_partner(target_person, person_from_model(member), is_healthtech=is_ht_req)
            if classification == "confirmed_duplicate":
                confirmed_ids.append(member.id)
            elif classification == "potential_duplicate":
                potential_ids.append(member.id)

    return {
        "requestId": request_id,
        "confirmedSiblingIds": confirmed_ids,
        "potentialSiblingCount": len(potential_ids),
        "confirmedSiblingCount": len(confirmed_ids),
        "potentialSiblingIds": potential_ids,
    }


def collect_selective_dismiss_targets(
    db: Session,
    req: models.ManagerRequest,
    *,
    also_delete_ids: Optional[List[str]] = None,
) -> Tuple[List[models.ManagerRequest], List[models.ManagerRequest]]:
    """Return (requests_to_dismiss, survivors_to_keep).

    Always deletes ``req``. When ``also_delete_ids`` is provided (frozen at
    Delete-confirm open), also deletes those IDs if they are still new members of
    the same group — late arrivals not in that list stay as survivors.
    When ``also_delete_ids`` is omitted, only ``req`` is deleted.
    """
    to_dismiss = [req]
    if not req.duplicate_group_id or req.status != "new":
        return to_dismiss, []

    peers = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.duplicate_group_id == req.duplicate_group_id,
            models.ManagerRequest.status == "new",
            models.ManagerRequest.id != req.id,
        )
        .all()
    )
    cascade = {mid for mid in (also_delete_ids or []) if mid and mid != req.id}
    if cascade:
        for peer in peers:
            if peer.id in cascade:
                to_dismiss.append(peer)

    dismiss_ids = {r.id for r in to_dismiss}
    survivors = [p for p in peers if p.id not in dismiss_ids]
    return to_dismiss, survivors



def finalize_group_after_selective_dismiss(
    db: Session,
    group: models.DuplicateGroup,
    survivor_ids: Set[str],
    admin_id: Optional[str] = None,
) -> None:
    """Reclassify or dissolve the group after confirmed siblings were dismissed."""
    now = datetime.now(timezone.utc)
    remaining = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.duplicate_group_id == group.id,
            models.ManagerRequest.status == "new",
            models.ManagerRequest.id.in_(list(survivor_ids)),
        )
        .all()
        if survivor_ids
        else []
    )

    def _mark_group_dismissed() -> None:
        group.status = "dismissed"
        group.resolved_at = now
        group.representative_request_id = None
        if admin_id and admin_id != "dev-bypass":
            try:
                group.resolved_by_admin_id = uuid.UUID(admin_id)
            except ValueError:
                pass

    if len(remaining) == 0:
        _mark_group_dismissed()
        db.flush()
        return

    if len(remaining) == 1 and not group.directory_person_id:
        remaining[0].duplicate_group_id = None
        _clear_duplicate_tags(remaining[0])
        _mark_group_dismissed()
        db.flush()
        return

    # Recalculate classification among survivors (same rules as unlink).
    dir_match = False
    peer_match_class = None

    if group.directory_person_id:
        dir_person = (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.id == group.directory_person_id)
            .first()
        )
        if dir_person:
            is_ht_surv  = is_healthtech_from_request(db, remaining[0]) if remaining else False
            is_gll_surv = is_gll_from_request(db, remaining[0]) if remaining else False
            for m in remaining:
                if not are_requests_dismissed(db, m.id, dir_person.id):
                    c, _ = match_classification_for_partner(
                        person_from_model(m), person_from_model(dir_person),
                        is_healthtech=is_ht_surv, is_gll=is_gll_surv,
                    )
                    if c:
                        dir_match = True
                        break

    is_ht_surv  = is_healthtech_from_request(db, remaining[0]) if remaining else False
    is_gll_surv = is_gll_from_request(db, remaining[0]) if remaining else False
    for i in range(len(remaining)):
        for j in range(i + 1, len(remaining)):
            if not are_requests_dismissed(db, remaining[i].id, remaining[j].id):
                c, _ = match_classification_for_partner(
                    person_from_model(remaining[i]),
                    person_from_model(remaining[j]),
                    is_healthtech=is_ht_surv, is_gll=is_gll_surv,
                )
                if c:
                    peer_match_class = _best_classification(peer_match_class, c)

    if dir_match and peer_match_class:
        new_class = (
            "already_removed_conflict"
            if (dir_person and _directory_is_off_roster(dir_person))
            else "already_exists_conflict"
        )
    elif dir_match:
        new_class = (
            "already_removed"
            if (dir_person and _directory_is_off_roster(dir_person))
            else "already_exists"
        )
    elif peer_match_class:
        new_class = peer_match_class
    else:
        new_class = None

    if not new_class:
        for m in remaining:
            m.duplicate_group_id = None
            _clear_duplicate_tags(m)
        _mark_group_dismissed()
    else:
        group.classification = new_class
        for m in remaining:
            _clear_duplicate_tags(m)
        _sync_group_representative_and_tags(db, group, member_requests=remaining)

    db.flush()


# ---------------------------------------------------------------------------
# Convenience read helpers (no writes)
# ---------------------------------------------------------------------------


def get_group_members(
    db: Session,
    group_id: str,
) -> List[models.ManagerRequest]:
    """Chronologically ordered list of all active requests in a group."""
    members = read_cache.cached(
        group_members_cache_key(group_id),
        lambda: (
            db.query(models.ManagerRequest)
            .filter(
                models.ManagerRequest.duplicate_group_id == group_id,
                models.ManagerRequest.status == "new",
            )
            .order_by(models.ManagerRequest.received_at.asc(), models.ManagerRequest.id.asc())
            .all()
        ),
    )
    return list(members)


def group_members_cache_key(group_id: str) -> tuple:
    return ("group_members", group_id)


def seed_group_members_cache(members_by_group: Dict[str, List[models.ManagerRequest]]) -> None:
    """Prime get_group_members for a read pass from members already loaded in bulk."""
    if not read_cache.is_active():
        return
    for group_id, members in members_by_group.items():
        ordered = sorted(
            members,
            key=lambda m: (m.received_at is None, _norm_dt(m.received_at), m.id or ""),
        )
        read_cache.seed(group_members_cache_key(group_id), ordered)


def _members_for_resolve_snapshot(
    all_members: List[models.ManagerRequest],
    member_ids: Optional[List[str]],
) -> Tuple[List[models.ManagerRequest], List[models.ManagerRequest]]:
    """Split group members into confirm-open snapshot vs late arrivals.

    Empty / omitted ``member_ids`` → legacy behavior (everyone is in the snapshot).
    """
    snapshot = {mid for mid in (member_ids or []) if mid}
    if not snapshot:
        return list(all_members), []
    members = [m for m in all_members if m.id in snapshot]
    late = [m for m in all_members if m.id and m.id not in snapshot]
    return members, late


def _detach_and_regroup_late_arrivals(
    db: Session,
    late_arrivals: List[models.ManagerRequest],
    *,
    exclude_id: Optional[str] = None,
) -> None:
    """Leave late arrivals out of a resolve: detach, then re-match (e.g. vs Directory)."""
    for late in late_arrivals:
        if not late or not late.id or late.id == exclude_id:
            continue
        late.duplicate_group_id = None
        _clear_duplicate_tags(late)
    db.flush()
    for late in late_arrivals:
        if not late or not late.id or late.id == exclude_id:
            continue
        db.refresh(late)
        process_request_grouping(db, late)
    db.flush()


def release_group_peers_after_mark_handled(
    db: Session,
    handled_req: models.ManagerRequest,
    *,
    admin_id: Optional[str] = None,
) -> None:
    """After Add User or Remove User confirm: peers that joined the group stay open.

    Shared by both buttons (same mark-handled API). The handled request becomes
    the Directory row. Any other ``new`` members on the same group (late arrivals
    while the confirm modal was open) are detached and re-matched against that
    Directory person (Already Exists for Add / Already Removed for Remove).
    """
    group_id = handled_req.duplicate_group_id
    handled_req.duplicate_group_id = None
    _clear_duplicate_tags(handled_req)
    db.flush()

    if not group_id:
        return

    group = (
        db.query(models.DuplicateGroup)
        .filter(models.DuplicateGroup.id == group_id)
        .first()
    )

    def _peers_on_group() -> List[models.ManagerRequest]:
        return (
            db.query(models.ManagerRequest)
            .filter(
                models.ManagerRequest.duplicate_group_id == group_id,
                models.ManagerRequest.status == "new",
                models.ManagerRequest.id != handled_req.id,
            )
            .all()
        )

    peers = _peers_on_group()
    for peer in peers:
        peer.duplicate_group_id = None
        _clear_duplicate_tags(peer)
    db.flush()

    # Catch attach races that landed between the first query and detach.
    for stray in _peers_on_group():
        stray.duplicate_group_id = None
        _clear_duplicate_tags(stray)
        peers.append(stray)
    db.flush()

    if group and group.status == "active":
        group.directory_person_id = handled_req.id
        group.representative_request_id = handled_req.id
        _finalize_group(
            db,
            group,
            resolution_type="mark_handled",
            final_values=None,
            previous_values=None,
            admin_id=admin_id,
            admin_note=None,
            now=datetime.now(timezone.utc),
        )

    db.flush()
    seen: Set[str] = set()
    for peer in peers:
        if not peer.id or peer.id in seen:
            continue
        seen.add(peer.id)
        db.refresh(peer)
        process_request_grouping(db, peer)
    db.flush()


def get_active_groups(
    db: Session,
    *,
    partner_id: Optional[str] = None,
    limit: int = 200,
) -> List[models.DuplicateGroup]:
    """All active duplicate groups, optionally scoped to a partner."""
    q = db.query(models.DuplicateGroup).filter(
        models.DuplicateGroup.status == "active"
    )
    if partner_id:
        q = q.filter(models.DuplicateGroup.partner_id == partner_id)
    return q.order_by(models.DuplicateGroup.created_at.desc()).limit(limit).all()


def compute_group_classification_summary(
    db: Session,
    group: models.DuplicateGroup,
    members: Optional[List[models.ManagerRequest]] = None,
) -> dict:
    """Compute per-request classification counts for a group (read-only).

    Live-classifies every member against its peers so the pill counts match the
    full group (not only the representative, which is the only row that keeps a
    peer-duplicate tag after sync).

    Returns:
        {
            "alreadyExists": bool,      # True if group has a directory_person_id
            "duplicateCount": int,       # members whose best peer match is confirmed
            "potentialCount": int,       # members whose best peer match is potential
        }
    """
    from app.duplicate_matching import get_all_rejected_nickname_pairs
    from app.nickname_match import rejected_nickname_pairs_scope

    with rejected_nickname_pairs_scope(get_all_rejected_nickname_pairs(db)):
        return _compute_group_classification_summary_impl(db, group, members)


def _compute_group_classification_summary_impl(
    db: Session,
    group: models.DuplicateGroup,
    members: Optional[List[models.ManagerRequest]] = None,
) -> dict:
    """Inner summary body (runs under rejected-nickname scope).

    Returns:
        {
            "alreadyExists": bool,
            "duplicateCount": int,
            "potentialCount": int,
        }

    Design notes:
    - Each member is counted at most once (confirmed wins over potential).
    - Already Exists / Already Removed are single flags from directory_person_id.
    - Dismissed pairs are skipped so unlinked false positives do not inflate counts.
    """
    if members is None:
        members = get_group_members(db, group.id)

    active_members = [m for m in members if m and m.id]
    duplicate_count = 0
    potential_count = 0

    already_exists = False
    already_removed = False
    dir_person = None
    if group.directory_person_id:
        # Read passes reuse the row the serializer already loaded (no pending writes).
        if read_cache.is_active():
            dir_person = db.get(models.ManagerRequest, group.directory_person_id)
        else:
            dir_person = db.query(models.ManagerRequest).filter_by(id=group.directory_person_id).first()
        if dir_person and _directory_is_off_roster(dir_person):
            already_removed = True
        elif dir_person:
            already_exists = True

    if len(active_members) >= 2:
        is_ht = is_healthtech_from_request(db, active_members[0])
        is_gll = is_gll_from_request(db, active_members[0])
        dismissed_set = get_all_dismissed_pairs(db)
        dir_left = person_from_model(dir_person) if dir_person else None

        for member in active_members:
            best: Optional[str] = None
            left = person_from_model(member)
            for other in active_members:
                if other.id == member.id:
                    continue
                if are_requests_dismissed(
                    db, member.id, other.id, dismissed_set=dismissed_set
                ):
                    continue
                classification, _ = match_classification_for_partner(
                    left,
                    person_from_model(other),
                    is_healthtech=is_ht,
                    is_gll=is_gll,
                )
                best = _best_classification(best, classification)
                if best == "confirmed_duplicate":
                    break
            # Directory-linked members may not peer-match each other; still count them.
            if best is None and dir_left is not None and member.id != getattr(dir_person, "id", None):
                if not are_requests_dismissed(
                    db, member.id, dir_person.id, dismissed_set=dismissed_set
                ):
                    classification, _ = match_classification_for_partner(
                        left,
                        dir_left,
                        is_healthtech=is_ht,
                        is_gll=is_gll,
                    )
                    best = classification
            if best == "confirmed_duplicate":
                duplicate_count += 1
            elif best == "potential_duplicate":
                potential_count += 1

        # Request History size is the source of truth — never undercount vs members.
        classified = duplicate_count + potential_count
        n = len(active_members)
        if n > classified:
            if duplicate_count > 0:
                potential_count = n - duplicate_count
            else:
                potential_count = n

    return {
        "alreadyExists": already_exists,
        "alreadyRemoved": already_removed,
        "duplicateCount": duplicate_count,
        "potentialCount": potential_count,
    }



# ---------------------------------------------------------------------------
# Task 2 — Resolution actions
# ---------------------------------------------------------------------------

# Outcome written to original group member requests when a group is resolved.
# Must NOT be "Added"/"Removed" — Directory ledger only surfaces those outcomes.
# Historical merge inputs stay GroupResolved so they never become Directory people.
OUTCOME_GROUP_RESOLVED = "GroupResolved"


def _validate_final_values(final_values: schemas.PersonInfo) -> None:
    """Raise ValueError if any required identity field is empty."""
    errors = []
    if not (final_values.firstName or "").strip():
        errors.append("firstName")
    if not (final_values.lastName or "").strip():
        errors.append("lastName")
    if errors:
        raise ValueError(f"finalValues missing required field(s): {', '.join(errors)}")


def _current_request_member(
    members: List[models.ManagerRequest],
    *,
    source_request_id: Optional[str] = None,
    representative_request_id: Optional[str] = None,
) -> Optional[models.ManagerRequest]:
    """The newest request in ``members`` — merges always land on the latest one.

    ``source_request_id`` / ``representative_request_id`` only break received_at
    ties: the stored representative can lag behind a request that joined while a
    merge was committing.
    """
    if not members:
        return None
    preferred = {rid for rid in (source_request_id, representative_request_id) if rid}
    return max(
        members,
        key=lambda m: (_norm_dt(m.received_at), m.id in preferred, m.id or ""),
    )


def _snapshot_source_manager_fields(source: models.ManagerRequest) -> Dict[str, str]:
    """Name/email/club for the request that drove Add / Update / Archive."""
    from app.intake_persons import get_admin_submitted_by, get_submitted_by_attribution
    from app.user_display import resolve_manager_fields, user_manager_fields
    from sqlalchemy.orm import object_session

    attributed = get_submitted_by_attribution(source)
    if any(attributed.values()):
        return attributed

    admin_submitted = get_admin_submitted_by(source)
    if any(admin_submitted.values()):
        return admin_submitted

    manager_user = getattr(source, "_manager_user", None)
    if manager_user is None and source.manager_id:
        session = object_session(source)
        if session is not None:
            manager_user = (
                session.query(models.PowermusicUser)
                .filter(models.PowermusicUser.id == source.manager_id)
                .first()
            )
            source._manager_user = manager_user
    if manager_user is not None:
        return user_manager_fields(manager_user)

    return resolve_manager_fields(source, manager_user=manager_user)


def _apply_merge_manager_provenance(
    dir_row: models.ManagerRequest,
    source: Optional[models.ManagerRequest],
    *,
    final_values: schemas.PersonInfo,
) -> None:
    """Replace Directory manager attribution with the updating request's manager.

    Used for Add to Directory, Add/Remove-and-Update, archive removes, and
    mark-removed — so the Manager column always reflects the latest request,
    not a hybrid of prior auto-mail / older manager fields.
    """
    from app.intake_persons import get_admin_submitted_by, get_submitted_by_attribution
    from app.manager_request_tags import (
        TAG_AUTO_MAIL,
        TAG_PARTNER_REQUEST,
        TAG_SENT_BY_ADMIN,
        TAG_VERIFIED,
        has_tag,
    )
    from app.person_compare import person_to_mapping
    from sqlalchemy.orm.attributes import flag_modified

    intake = dict(dir_row.intake_persons or {})
    intake["admin"] = person_to_mapping(final_values)
    
    tags = list(dir_row.tags or [])
    if TAG_VERIFIED not in tags:
        tags.append(TAG_VERIFIED)

    if source is not None:
        dir_row.manager_id = source.manager_id
        if hasattr(source, "_manager_user"):
            dir_row._manager_user = getattr(source, "_manager_user", None)
        else:
            dir_row._manager_user = None
            
        dir_row.manager_notes = source.manager_notes
        dir_row.source_email_id = source.source_email_id
        # source_gmail_message_id is UNIQUE — move it off the source (and any
        # other holders) before assigning to the Directory row, or merge/update
        # fails with UniqueViolation when Directory and source are different rows.
        msg_id = (source.source_gmail_message_id or "").strip() or None
        if msg_id and dir_row.id != source.id:
            from sqlalchemy.orm import object_session
            session = object_session(dir_row) or object_session(source)
            source.source_gmail_message_id = None
            if session is not None:
                session.query(models.ManagerRequest).filter(
                    models.ManagerRequest.source_gmail_message_id == msg_id,
                    models.ManagerRequest.id != dir_row.id,
                ).update(
                    {models.ManagerRequest.source_gmail_message_id: None},
                    synchronize_session=False,
                )
                session.flush()
            dir_row.source_gmail_message_id = msg_id
        elif msg_id:
            dir_row.source_gmail_message_id = msg_id

        source_tags = source.tags or []

        # Always overwrite Directory manager display with this request's manager.
        manager_fields = _snapshot_source_manager_fields(source)
        has_named_manager = bool(
            (manager_fields.get("firstName") or "").strip()
            or (manager_fields.get("lastName") or "").strip()
            or (manager_fields.get("email") or "").strip()
        )
        if any(manager_fields.values()):
            intake["submittedBy"] = {
                "firstName": manager_fields.get("firstName") or "",
                "lastName": manager_fields.get("lastName") or "",
                "email": manager_fields.get("email") or "",
                "club": manager_fields.get("club") or "",
            }
        else:
            intake.pop("submittedBy", None)

        admin_submitted = get_admin_submitted_by(source)
        if any(admin_submitted.values()):
            intake["adminSubmittedBy"] = admin_submitted
        else:
            intake.pop("adminSubmittedBy", None)

        source_is_pure_auto = (
            has_tag(source_tags, TAG_AUTO_MAIL)
            and not source.manager_id
            and not has_tag(source_tags, TAG_PARTNER_REQUEST)
            and not has_named_manager
        )
        manager_owns_update = not source_is_pure_auto and (
            bool(source.manager_id)
            or has_tag(source_tags, TAG_PARTNER_REQUEST)
            or has_tag(source_tags, TAG_SENT_BY_ADMIN)
            or has_named_manager
        )

        if manager_owns_update:
            # Replace auto-mail column attribution entirely.
            tags = [t for t in tags if str(t).strip().lower() != TAG_AUTO_MAIL]
            if not msg_id:
                dir_row.source_gmail_message_id = None
            # Stale auto-mail meta must not keep the Auto Email Request label.
            intake.pop("autoMailMeta", None)
            if TAG_PARTNER_REQUEST not in tags:
                tags.append(TAG_PARTNER_REQUEST)
        if has_tag(source_tags, TAG_SENT_BY_ADMIN) or (
            not source.manager_id
            and has_named_manager
            and not has_tag(source_tags, TAG_AUTO_MAIL)
        ):
            if TAG_SENT_BY_ADMIN not in tags:
                tags.append(TAG_SENT_BY_ADMIN)
    else:
        # Admin merge with no manager on any member — treat as admin form entry.
        if TAG_PARTNER_REQUEST not in tags:
            tags.append(TAG_PARTNER_REQUEST)
        if TAG_SENT_BY_ADMIN not in tags:
            tags.append(TAG_SENT_BY_ADMIN)

    dir_row.intake_persons = intake
    flag_modified(dir_row, "intake_persons")
    dir_row.tags = tags
    flag_modified(dir_row, "tags")


def _apply_final_values_to_request(
    req: models.ManagerRequest,
    final_values: schemas.PersonInfo,
) -> None:
    """Write admin-confirmed identity fields onto an open request (peers merge)."""
    from app.intake_persons import set_director_fields

    req.person_first_name = (final_values.firstName or "").strip()
    req.person_last_name = (final_values.lastName or "").strip()
    req.person_email = (final_values.email or "").strip()
    req.person_location = (final_values.location or "").strip()
    if hasattr(final_values, "role") and final_values.role is not None:
        req.role = (final_values.role or "").strip() or None
    if (
        getattr(final_values, "directorFirst", None) is not None
        or getattr(final_values, "directorLast", None) is not None
    ):
        set_director_fields(
            req,
            getattr(final_values, "directorFirst", None) or "",
            getattr(final_values, "directorLast", None) or "",
        )


def _transfer_dismissals_onto_survivor(
    db: Session,
    survivor_id: str,
    discarded_ids: List[str],
    *,
    admin_id: Optional[str] = None,
) -> None:
    """Before deleting peers, copy their Not-the-Same-Person barriers onto the survivor.

    permanently_delete_requests wipes dismissals that reference deleted IDs. Without
    this transfer, lookalike barriers recorded against older history rows vanish
    after Request History Merge.
    """
    discarded = {did for did in discarded_ids if did and did != survivor_id}
    if not survivor_id or not discarded:
        return

    now = datetime.now(timezone.utc)
    admin_uuid = admin_id if admin_id and admin_id != "dev-bypass" else None

    pair_rows = (
        db.query(models.DismissedDuplicateMatch)
        .filter(
            or_(
                models.DismissedDuplicateMatch.request_id_1.in_(list(discarded)),
                models.DismissedDuplicateMatch.request_id_2.in_(list(discarded)),
            )
        )
        .all()
    )
    for row in pair_rows:
        other = (
            row.request_id_2
            if row.request_id_1 in discarded
            else row.request_id_1
        )
        if not other or other in discarded or other == survivor_id:
            continue
        if are_requests_dismissed(db, survivor_id, other):
            continue
        db.add(
            models.DismissedDuplicateMatch(
                id=f"dism-{uuid.uuid4().hex[:12]}",
                request_id_1=survivor_id,
                request_id_2=other,
                dismissed_by_admin_id=admin_uuid,
                created_at=now,
            )
        )

    group_rows = (
        db.query(models.DismissedGroupMatch)
        .filter(models.DismissedGroupMatch.request_id.in_(list(discarded)))
        .all()
    )
    for row in group_rows:
        if not row.group_id:
            continue
        if is_request_dismissed_from_group(db, survivor_id, row.group_id):
            continue
        db.add(
            models.DismissedGroupMatch(
                id=f"dism-grp-{uuid.uuid4().hex[:12]}",
                request_id=survivor_id,
                group_id=row.group_id,
                dismissed_by_admin_id=admin_uuid,
                created_at=now,
            )
        )
    db.flush()


def merge_group_peers(
    db: Session,
    group_id: str,
    final_values: schemas.PersonInfo,
    *,
    source_request_id: Optional[str] = None,
    admin_id: Optional[str] = None,
    member_ids: Optional[List[str]] = None,
) -> Optional[dict]:
    """Collapse Request History inside an active group to one open request.

    Used by every multi-request resolve path (Add / Update / Keep Existing /
    Archive / Attach lookalike) before the final action. Unlike bulk-dismiss:

      * The group stays **active**
      * The survivor stays on this ``duplicate_group_id``
      * Confirmed ``final_values`` are written onto the survivor
      * Not-the-Same-Person dismissals from deleted peers transfer to the survivor

    Directory linkage (``directory_person_id``) is never cleared here.

    When ``member_ids`` is provided, only those peers are merged. Requests that
    joined the group after the admin opened Merge (live arrivals) stay listed.

    Returns ``{survivorRequestId, deletedIds, groupId, memberCount}`` or None.
    Raises ``ValueError`` when final_values are invalid.
    """
    _validate_final_values(final_values)

    # Lock before reading members: a request joining mid-merge must either be
    # visible below (stays as a late arrival) or wait, so neither transaction
    # overwrites the other's representative with an older request.
    group = (
        db.query(models.DuplicateGroup)
        .filter(models.DuplicateGroup.id == group_id)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if not group or group.status != "active":
        return None

    all_new_members = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.duplicate_group_id == group.id,
            models.ManagerRequest.status == "new",
        )
        .all()
    )
    # Never treat the Directory row as a mergeable peer.
    all_peers = [
        m for m in all_new_members
        if m.id and m.id != group.directory_person_id
    ]
    if not all_peers:
        return None

    snapshot = {mid for mid in (member_ids or []) if mid}
    # Empty / omitted snapshot → legacy behavior (merge everyone currently in group).
    members = (
        [m for m in all_peers if m.id in snapshot]
        if snapshot
        else list(all_peers)
    )
    if not members:
        return None

    survivor = _current_request_member(
        members,
        source_request_id=source_request_id,
        representative_request_id=group.representative_request_id,
    )
    if not survivor:
        return None

    discarded = [m for m in members if m.id != survivor.id]
    discarded_ids = [m.id for m in discarded]

    _apply_final_values_to_request(survivor, final_values)

    if discarded_ids:
        _transfer_dismissals_onto_survivor(
            db,
            survivor.id,
            discarded_ids,
            admin_id=admin_id,
        )
        merge_requests_into(db, discarded_ids, survivor)

    # Critical: do NOT call finalize_group_after_selective_dismiss — that path
    # ungroups a sole peer when there is no Directory match.
    group.status = "active"
    group.resolved_at = None

    discarded_set = set(discarded_ids)
    remaining_peers = [
        m for m in all_peers
        if m.id == survivor.id or m.id not in discarded_set
    ]
    # Late arrivals (not in snapshot) remain; include them in sync.
    if survivor.id not in {m.id for m in remaining_peers}:
        remaining_peers = [survivor] + remaining_peers
    _sync_group_representative_and_tags(db, group, member_requests=remaining_peers)

    # Peer history among the snapshot is gone. Keep Already Exists / Already Removed
    # when Directory is linked; peer-duplicate pills follow remaining member count.
    if group.directory_person_id:
        dir_person = (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.id == group.directory_person_id)
            .first()
        )
        if dir_person and _directory_is_off_roster(dir_person):
            if group.classification not in (
                "already_removed",
                "already_removed_conflict",
            ):
                group.classification = "already_removed"
        else:
            if group.classification not in (
                "already_exists",
                "already_exists_conflict",
            ):
                group.classification = "already_exists"

    db.flush()

    return {
        "survivorRequestId": survivor.id,
        "deletedIds": discarded_ids,
        "groupId": group.id,
        "memberCount": len(remaining_peers),
    }


def permanently_delete_requests(db: Session, request_ids: List[str]) -> int:
    """Permanently delete manager requests from the database along with all dependent references.

    Cascade cleanups performed:
    1. Decrement manager pending stats for any deleted requests with status == "new".
    2. Nullify DuplicateGroup.representative_request_id and DuplicateGroup.directory_person_id where referencing deleted IDs.
    3. Delete referencing rows in DismissedDuplicateMatch, DismissedGroupMatch, and ManagerRequestView.
    4. Physically delete ManagerRequest records.

    Returns the count of ManagerRequest rows deleted.
    """
    if not request_ids:
        return 0
    from sqlalchemy import delete, update, or_
    valid_ids = [rid for rid in request_ids if rid]
    if not valid_ids:
        return 0

    rows = db.query(models.ManagerRequest).filter(models.ManagerRequest.id.in_(valid_ids)).all()
    if not rows:
        return 0

    actual_ids = [r.id for r in rows]

    # Record source_gmail_message_ids into processed_gmail_messages so background
    # Gmail sync/polling never re-imports deleted message IDs as new requests.
    from app.processed_gmail_messages import record_processed_gmail_message
    for r in rows:
        if r.source_gmail_message_id:
            record_processed_gmail_message(db, r.source_gmail_message_id)

    # Decrement manager pending stats for active requests being deleted
    from app.manager_request_stats import decrement_manager_pending_stat
    from app.manager_request_summary_cache import invalidate_manager_request_summary
    for r in rows:
        if r.status == "new":
            decrement_manager_pending_stat(db, r)
            if r.manager_id:
                invalidate_manager_request_summary(str(r.manager_id))

    # 1–3. Group pointers + duplicate dismissals
    _clear_admin_references(db, actual_ids)

    # 4. Delete related ManagerRequestView rows
    db.execute(
        delete(models.ManagerRequestView)
        .where(models.ManagerRequestView.request_id.in_(actual_ids))
    )

    # 5. Delete the actual ManagerRequest records
    deleted_count = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id.in_(actual_ids))
        .delete(synchronize_session=False)
    )
    db.flush()
    return deleted_count


def _clear_admin_references(db: Session, request_ids: List[str]) -> None:
    """Drop duplicate-group pointers and dismissal pairs for rows leaving the admin app."""
    from sqlalchemy import delete, update

    if not request_ids:
        return
    db.execute(
        update(models.DuplicateGroup)
        .where(models.DuplicateGroup.directory_person_id.in_(request_ids))
        .values(directory_person_id=None)
    )
    db.execute(
        update(models.DuplicateGroup)
        .where(models.DuplicateGroup.representative_request_id.in_(request_ids))
        .values(representative_request_id=None)
    )
    db.execute(
        delete(models.DismissedDuplicateMatch)
        .where(
            or_(
                models.DismissedDuplicateMatch.request_id_1.in_(request_ids),
                models.DismissedDuplicateMatch.request_id_2.in_(request_ids),
            )
        )
    )
    db.execute(
        delete(models.DismissedGroupMatch)
        .where(models.DismissedGroupMatch.request_id.in_(request_ids))
    )


def _hide_from_admin(
    db: Session,
    rows: List[models.ManagerRequest],
    *,
    status: str,
    merged_into_id: Optional[str] = None,
) -> None:
    if not rows:
        return
    _clear_admin_references(db, [r.id for r in rows])
    for r in rows:
        r.status = status
        r.merged_into_request_id = merged_into_id
        r.duplicate_group_id = None
    db.flush()


def admin_delete_requests(db: Session, request_ids: List[str]) -> int:
    """Admin Delete (New Requests, group members, Directory).

    Manager portal submissions are hidden from the admin app but kept, unchanged,
    in the manager's request history. Rows no manager can see are permanently deleted.
    Returns the number of rows removed from the admin app.
    """
    from app.manager_request_stats import is_manager_portal_request
    from app.request_visibility import STATUS_ADMIN_DELETED, admin_visible_filter

    valid_ids = [rid for rid in (request_ids or []) if rid]
    if not valid_ids:
        return 0
    rows = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id.in_(valid_ids), admin_visible_filter())
        .all()
    )
    if not rows:
        return 0

    keep = [r for r in rows if is_manager_portal_request(r)]
    drop_ids = [r.id for r in rows if not is_manager_portal_request(r)]
    _hide_from_admin(db, keep, status=STATUS_ADMIN_DELETED)
    if drop_ids:
        permanently_delete_requests(db, drop_ids)
    return len(rows)


def sync_requests_merged_into(db: Session, survivor: Optional[models.ManagerRequest]) -> int:
    """Merged duplicates show as Handled to their managers once the survivor is handled."""
    from app.manager_request_stats import decrement_manager_pending_stat
    from app.manager_request_summary_cache import invalidate_manager_request_summary
    from app.request_visibility import STATUS_HANDLED, STATUS_MERGED

    if survivor is None or survivor.status != STATUS_HANDLED or not survivor.handled_at:
        return 0
    peers = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.merged_into_request_id == survivor.id,
            models.ManagerRequest.status == STATUS_MERGED,
            models.ManagerRequest.handled_at.is_(None),
        )
        .all()
    )
    for peer in peers:
        peer.handled_at = survivor.handled_at
        peer.outcome = survivor.outcome
        decrement_manager_pending_stat(db, peer)
        if peer.manager_id:
            invalidate_manager_request_summary(str(peer.manager_id))
    if peers:
        db.flush()
    return len(peers)


def merge_requests_into(
    db: Session,
    request_ids: List[str],
    survivor: Optional[models.ManagerRequest],
) -> int:
    """Fold duplicate requests into ``survivor`` (merge peers / resolve a group).

    Manager portal rows are kept as status "merged": Pending to the manager while
    the survivor is open, Handled (with the survivor's outcome) once it is added
    or removed. Rows no manager can see are permanently deleted.
    """
    from app.manager_request_stats import is_manager_portal_request
    from app.request_visibility import STATUS_MERGED

    if survivor is None:
        return admin_delete_requests(db, request_ids)

    valid_ids = [rid for rid in (request_ids or []) if rid and rid != survivor.id]
    if not valid_ids:
        sync_requests_merged_into(db, survivor)
        return 0
    rows = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id.in_(valid_ids))
        .all()
    )
    if not rows:
        sync_requests_merged_into(db, survivor)
        return 0

    # Earlier merges into these rows now resolve to the new survivor.
    ids = [r.id for r in rows]
    for chained in (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.merged_into_request_id.in_(ids))
        .all()
    ):
        chained.merged_into_request_id = survivor.id

    keep = [r for r in rows if is_manager_portal_request(r)]
    drop_ids = [r.id for r in rows if not is_manager_portal_request(r)]
    _hide_from_admin(db, keep, status=STATUS_MERGED, merged_into_id=survivor.id)
    if drop_ids:
        permanently_delete_requests(db, drop_ids)
    sync_requests_merged_into(db, survivor)
    return len(rows)


def _finalize_group(
    db: Session,
    group: models.DuplicateGroup,
    *,
    resolution_type: str,
    final_values: Optional[schemas.PersonInfo],
    previous_values: Optional[schemas.PersonInfo],
    admin_id: Optional[str],
    admin_note: Optional[str],
    now: datetime,
) -> None:
    """Stamp resolution metadata onto the group and set status='resolved'."""
    meta: dict = {"resolution_type": resolution_type}
    if final_values:
        meta["final_values"] = {
            "firstName": final_values.firstName or "",
            "lastName": final_values.lastName or "",
            "email": final_values.email or "",
            "location": final_values.location or "",
        }
        if getattr(final_values, "role", None):
            meta["final_values"]["role"] = final_values.role
        if getattr(final_values, "directorFirst", None):
            meta["final_values"]["directorFirst"] = final_values.directorFirst
        if getattr(final_values, "directorLast", None):
            meta["final_values"]["directorLast"] = final_values.directorLast
    if previous_values:
        meta["previous_values"] = {
            "firstName": previous_values.firstName or "",
            "lastName": previous_values.lastName or "",
            "email": previous_values.email or "",
            "location": previous_values.location or "",
        }
        if getattr(previous_values, "role", None):
            meta["previous_values"]["role"] = previous_values.role
        if getattr(previous_values, "directorFirst", None):
            meta["previous_values"]["directorFirst"] = previous_values.directorFirst
        if getattr(previous_values, "directorLast", None):
            meta["previous_values"]["directorLast"] = previous_values.directorLast
    if admin_note:
        meta["admin_note"] = admin_note

    group.resolution_metadata = meta
    group.status = "resolved"
    group.resolved_at = now
    admin_uuid = None
    if admin_id and admin_id != "dev-bypass":
        try:
            from uuid import UUID
            admin_uuid = UUID(admin_id)
        except ValueError:
            pass
    if admin_uuid:
        group.resolved_by_admin_id = admin_uuid


def _snapshot_discarded_manager_requests(
    directory_person: models.ManagerRequest,
    members: List[models.ManagerRequest],
    existing_stored_ids: set,
) -> list:
    """Discarded/consumed member requests are terminal and must never be snapshotted

    into the Directory record's intake_persons['history'].
    """
    return []



# ── Case A: Resolve & Add ────────────────────────────────────────────────────


def resolve_group_add(
    db: Session,
    group: models.DuplicateGroup,
    *,
    final_values: schemas.PersonInfo,
    admin_id: Optional[str],
    partner_id: Optional[str] = None,
    admin_note: Optional[str] = None,
    source_request_id: Optional[str] = None,
    member_ids: Optional[List[str]] = None,
) -> models.ManagerRequest:
    """Create ONE Directory record from final_values, resolve the group, and permanently delete discarded requests.

    Invariants:
    - Retains the representative / source request, updating it in-place to status="handled", outcome="Added".
    - Permanently deletes other snapshot member requests in the group.
    - When ``member_ids`` is provided, peers that joined after confirm stay open and
      re-group against the new Directory person (Already Exists).
    - Stamps group resolution metadata, links directory_person_id, and sets status='resolved'.
    - Does NOT call db.commit() — router commits.

    Returns the Directory ManagerRequest row.
    """
    _validate_final_values(final_values)
    now = datetime.now(timezone.utc)

    all_members = get_group_members(db, group.id)
    members, late_arrivals = _members_for_resolve_snapshot(all_members, member_ids)
    # Determine the retained request:
    retained_req = _current_request_member(
        members,
        source_request_id=source_request_id,
        representative_request_id=group.representative_request_id,
    )
    if retained_req is None and members:
        # Fallback to the latest member
        members_sorted = sorted(
            members,
            key=lambda r: (_norm_dt(r.received_at), r.id or ""),
            reverse=True,
        )
        retained_req = members_sorted[0]

    from app.user_display import hydrate_request_users
    hydrate_request_users(db, members + late_arrivals)

    admin_uuid = None
    if admin_id and admin_id != "dev-bypass":
        try:
            from uuid import UUID
            admin_uuid = UUID(admin_id)
        except ValueError:
            pass

    from app.manager_request_stats import decrement_manager_pending_stat
    from app.manager_request_summary_cache import invalidate_manager_request_summary

    if retained_req:
        dir_row = retained_req
        was_new = dir_row.status == "new"
        dir_row.status = "handled"
        dir_row.outcome = "Added"
        dir_row.action = "Add"
        dir_row.handled_at = now
        dir_row.person_first_name = (final_values.firstName or "").strip()
        dir_row.person_last_name = (final_values.lastName or "").strip()
        dir_row.person_email = (final_values.email or "").strip()
        dir_row.person_location = (final_values.location or "").strip()
        if hasattr(final_values, "role") and final_values.role is not None:
            dir_row.role = (final_values.role or "").strip() or None
        if getattr(final_values, "directorFirst", None) is not None or getattr(final_values, "directorLast", None) is not None:
            from app.intake_persons import set_director_fields
            set_director_fields(
                dir_row,
                getattr(final_values, "directorFirst", None) or "",
                getattr(final_values, "directorLast", None) or "",
            )
        _apply_merge_manager_provenance(dir_row, retained_req, final_values=final_values)
        if admin_uuid:
            dir_row.handled_by_admin_id = admin_uuid
        if admin_note:
            dir_row.admin_notes = admin_note
        _clear_duplicate_tags(dir_row)
        dir_row.duplicate_group_id = None
        if was_new:
            decrement_manager_pending_stat(db, dir_row)
            if dir_row.manager_id:
                invalidate_manager_request_summary(str(dir_row.manager_id))
    else:
        from app.request_display import allocate_request_ids
        (new_id,) = allocate_request_ids(db, 1)
        dir_row = models.ManagerRequest(
            id=new_id,
            received_at=now,
            handled_at=now,
            status="handled",
            outcome="Added",
            action="Add",
            person_first_name=(final_values.firstName or "").strip(),
            person_last_name=(final_values.lastName or "").strip(),
            person_email=(final_values.email or "").strip(),
            person_location=(final_values.location or "").strip(),
            role=(final_values.role or "").strip() or None if hasattr(final_values, "role") and final_values.role else None,
            intake_persons={},
            tags=[],
            partner_id=partner_id or group.partner_id,
        )
        if getattr(final_values, "directorFirst", None) or getattr(final_values, "directorLast", None):
            from app.intake_persons import set_director_fields
            set_director_fields(
                dir_row,
                getattr(final_values, "directorFirst", None) or "",
                getattr(final_values, "directorLast", None) or "",
            )
        if admin_uuid:
            dir_row.handled_by_admin_id = admin_uuid
        if admin_note:
            dir_row.admin_notes = admin_note
        db.add(dir_row)
        db.flush()

    # Fold discarded snapshot peers into the Directory row (not late arrivals).
    discarded_ids = [m.id for m in members if m.id != dir_row.id]
    # Unconditional: also syncs requests merged into this row earlier.
    merge_requests_into(db, discarded_ids, dir_row)

    # Link the group to the Directory row
    group.directory_person_id = dir_row.id
    group.representative_request_id = dir_row.id

    # Stamp the audit metadata and close the group.
    _finalize_group(
        db, group,
        resolution_type="add",
        final_values=final_values,
        previous_values=None,
        admin_id=admin_id,
        admin_note=admin_note,
        now=now,
    )
    db.flush()
    _detach_and_regroup_late_arrivals(db, late_arrivals, exclude_id=dir_row.id)
    return dir_row


# ── Case A2: Not the same person as Directory — Add as new ───────────────────


def resolve_group_add_as_new(
    db: Session,
    group: models.DuplicateGroup,
    *,
    final_values: schemas.PersonInfo,
    admin_id: Optional[str],
    partner_id: Optional[str] = None,
    admin_note: Optional[str] = None,
    source_request_id: Optional[str] = None,
    member_ids: Optional[List[str]] = None,
) -> models.ManagerRequest:
    """False-positive vs Directory: dismiss the Directory link, then add as a new person.

    Leaves the existing Directory record unchanged. Persists dismissed pairs so the
    snapshot incoming request(s) are not re-linked to that Directory person on regrouping.
    When the first names were nickname-related (not exact), also learns that those
    two nicknames are different for all future matching.
    Then resolves like Case A (create/update a NEW Directory row from final_values).

    Late arrivals (``member_ids``) are not dismissed vs the old Directory and are
    left for ``resolve_group_add`` to re-group against Directory.

    Requires group.directory_person_id. Does NOT call db.commit().
    """
    from app.duplicate_matching import record_rejected_nickname_pair
    from app.nickname_match import is_nickname_only_first_match, ordered_nickname_pair

    old_dir_id = group.directory_person_id
    if not old_dir_id:
        raise ValueError(
            "This group has no linked Directory person. Use resolve-add instead."
        )

    now = datetime.now(timezone.utc)
    admin_uuid = None
    if admin_id and admin_id != "dev-bypass":
        try:
            from uuid import UUID
            admin_uuid = UUID(admin_id)
        except ValueError:
            pass

    old_dir = db.query(models.ManagerRequest).filter_by(id=old_dir_id).first()
    dir_first = (old_dir.person_first_name if old_dir else None) or ""
    incoming_first = (final_values.firstName if final_values else None) or ""
    all_members = get_group_members(db, group.id)
    members, late_arrivals = _members_for_resolve_snapshot(all_members, member_ids)

    # Learn nicknames only for the confirm-open snapshot (not late arrivals).
    learned_nickname_pair = None
    learn_candidates = [incoming_first]
    for member in members:
        if member and member.id and member.id != old_dir_id:
            learn_candidates.append(member.person_first_name or "")
    seen_keys = set()
    for cand in learn_candidates:
        if not is_nickname_only_first_match(dir_first, cand):
            continue
        key = ordered_nickname_pair(dir_first, cand)
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)
        learned = record_rejected_nickname_pair(
            db,
            dir_first,
            cand,
            admin_id=admin_id,
            source_group_id=group.id,
        )
        if learned and learned_nickname_pair is None:
            learned_nickname_pair = key

    # Dismiss only snapshot peers vs old Directory — late arrivals may still match it.
    for member in members:
        if not member.id or member.id == old_dir_id:
            continue
        if not are_requests_dismissed(db, old_dir_id, member.id):
            db.add(
                models.DismissedDuplicateMatch(
                    id=f"dism-{uuid.uuid4().hex[:12]}",
                    request_id_1=old_dir_id,
                    request_id_2=member.id,
                    dismissed_by_admin_id=admin_uuid,
                    created_at=now,
                )
            )

    # Detach the false Directory link so Case A resolve-add can proceed.
    group.directory_person_id = None
    db.flush()

    dir_row = resolve_group_add(
        db,
        group,
        final_values=final_values,
        admin_id=admin_id,
        partner_id=partner_id,
        admin_note=admin_note,
        source_request_id=source_request_id,
        member_ids=member_ids,
    )

    meta = dict(group.resolution_metadata or {})
    meta["resolution_type"] = "add_as_new"
    meta["dismissed_directory_person_id"] = old_dir_id
    if learned_nickname_pair:
        meta["rejected_nickname_pair"] = {
            "nameA": learned_nickname_pair[0],
            "nameB": learned_nickname_pair[1],
        }
    group.resolution_metadata = meta
    db.flush()
    # Late arrivals are detached + re-grouped inside resolve_group_add (member_ids).
    return dir_row


def resolve_group_keep_existing_and_archive(
    db: Session,
    group: models.DuplicateGroup,
    *,
    final_values: schemas.PersonInfo,
    admin_id: Optional[str],
    admin_note: Optional[str] = None,
    source_request_id: Optional[str] = None,
    member_ids: Optional[List[str]] = None,
) -> models.ManagerRequest:
    """False-positive Remove vs Directory: leave Directory unchanged; archive the Remove request.

    Mirrors add-as-new for Remove flows:
      - Dismisses pairs vs the linked Directory person so regrouping does not re-attach.
      - Applies final_values onto the retained Remove request.
      - Marks that request handled / Removed / archived (existing archive convention).
      - Permanently deletes other snapshot members.
      - Late arrivals (``member_ids``) stay open and re-group against Directory.
      - Does NOT modify the Directory record.

    Requires group.directory_person_id. Does NOT call db.commit().
    Returns the archived Remove request row.
    """
    from app.manager_request_stats import decrement_manager_pending_stat
    from app.manager_request_summary_cache import invalidate_manager_request_summary
    from app.manager_request_tags import TAG_REMOVED

    old_dir_id = group.directory_person_id
    if not old_dir_id:
        raise ValueError(
            "This group has no linked Directory person. Use resolve-mark-removed instead."
        )

    _validate_final_values(final_values)
    now = datetime.now(timezone.utc)
    admin_uuid = None
    if admin_id and admin_id != "dev-bypass":
        try:
            from uuid import UUID
            admin_uuid = UUID(admin_id)
        except ValueError:
            pass

    all_members = get_group_members(db, group.id)
    members, late_arrivals = _members_for_resolve_snapshot(all_members, member_ids)
    if not members:
        raise ValueError("No incoming requests to archive in this group.")

    # Dismiss only snapshot peers — late arrivals must still match Directory.
    for member in members:
        if not member.id or member.id == old_dir_id:
            continue
        if not are_requests_dismissed(db, old_dir_id, member.id):
            db.add(
                models.DismissedDuplicateMatch(
                    id=f"dism-{uuid.uuid4().hex[:12]}",
                    request_id_1=old_dir_id,
                    request_id_2=member.id,
                    dismissed_by_admin_id=admin_uuid,
                    created_at=now,
                )
            )

    retained_req = _current_request_member(
        members,
        source_request_id=source_request_id,
        representative_request_id=group.representative_request_id,
    )
    if retained_req is None:
        retained_req = max(members, key=lambda m: _norm_dt(m.received_at))

    was_new = retained_req.status == "new"
    retained_req.status = "handled"
    retained_req.outcome = "Removed"
    retained_req.action = "Remove"
    retained_req.handled_at = now
    retained_req.archived_at = now
    retained_req.person_first_name = (final_values.firstName or "").strip()
    retained_req.person_last_name = (final_values.lastName or "").strip()
    retained_req.person_email = (final_values.email or "").strip()
    retained_req.person_location = (final_values.location or "").strip()
    if hasattr(final_values, "role") and final_values.role is not None:
        retained_req.role = (final_values.role or "").strip() or None
    if getattr(final_values, "directorFirst", None) is not None or getattr(final_values, "directorLast", None) is not None:
        from app.intake_persons import set_director_fields
        set_director_fields(
            retained_req,
            getattr(final_values, "directorFirst", None) or "",
            getattr(final_values, "directorLast", None) or "",
        )

    manager_source = _current_request_member(
        members,
        source_request_id=source_request_id,
        representative_request_id=group.representative_request_id,
    )
    _apply_merge_manager_provenance(retained_req, manager_source, final_values=final_values)

    if admin_uuid:
        retained_req.handled_by_admin_id = admin_uuid
    if admin_note:
        retained_req.admin_notes = admin_note
    _clear_duplicate_tags(retained_req)
    tags = list(retained_req.tags or [])
    if TAG_REMOVED not in tags:
        tags.append(TAG_REMOVED)
    retained_req.tags = tags
    retained_req.duplicate_group_id = None

    if was_new:
        decrement_manager_pending_stat(db, retained_req)
        if retained_req.manager_id:
            invalidate_manager_request_summary(str(retained_req.manager_id))

    discarded_ids = [m.id for m in members if m.id != retained_req.id]
    # Unconditional: also syncs requests merged into this row earlier.
    merge_requests_into(db, discarded_ids, retained_req)

    # Directory link stays for audit; Directory row itself is untouched.
    group.representative_request_id = retained_req.id

    _finalize_group(
        db, group,
        resolution_type="keep_existing_and_archive",
        final_values=final_values,
        previous_values=None,
        admin_id=admin_id,
        admin_note=admin_note,
        now=now,
    )
    meta = dict(group.resolution_metadata or {})
    meta["resolution_type"] = "keep_existing_and_archive"
    meta["dismissed_directory_person_id"] = old_dir_id
    meta["archived_request_id"] = retained_req.id
    group.resolution_metadata = meta
    db.flush()
    _detach_and_regroup_late_arrivals(db, late_arrivals, exclude_id=retained_req.id)
    return retained_req


# ── Case B: Resolve & Update ─────────────────────────────────────────────────


def resolve_group_update(
    db: Session,
    group: models.DuplicateGroup,
    directory_person: models.ManagerRequest,
    *,
    final_values: schemas.PersonInfo,
    admin_id: Optional[str],
    admin_note: Optional[str] = None,
    source_request_id: Optional[str] = None,
    member_ids: Optional[List[str]] = None,
) -> models.ManagerRequest:
    """Update an eligible active Directory record in-place; resolve group and delete snapshot requests.

    Status transitions (alongside the field update):
    - Incoming Remove → archive the Directory row (active → archive).
    - Incoming Add → update fields; remain active.

    Archived/Removed Directory rows are never updated or restored here — callers
    must use resolve_group_add (normal new Add) when only archived matches exist.

    Invariants:
    - Caller must pass an eligible active Directory match (see load_eligible_directory_person).
    - Updates directory_person in-place (selected id, not a silent primary fallback).
    - Permanently deletes snapshot incoming member requests.
    - Late arrivals (``member_ids``) stay open and re-group against the updated Directory.
    - Does NOT call db.commit() — router commits.

    Returns the updated Directory ManagerRequest row.
    """
    _validate_final_values(final_values)
    now = datetime.now(timezone.utc)

    if _directory_is_off_roster(directory_person) or (directory_person.outcome or "") != "Added":
        raise ValueError(
            "Archived or removed Directory records cannot be updated or restored "
            "by an incoming request. Use Add to Directory to create a new active record."
        )

    all_members = get_group_members(db, group.id)
    members, late_arrivals = _members_for_resolve_snapshot(all_members, member_ids)
    from app.user_display import hydrate_request_users
    hydrate_request_users(db, members + late_arrivals + [directory_person])

    # Snapshot the current values for audit BEFORE modifying.
    from app.intake_persons import get_director_fields
    prev_dir = get_director_fields(directory_person)
    previous = schemas.PersonInfo(
        firstName=directory_person.person_first_name or "",
        lastName=directory_person.person_last_name or "",
        email=directory_person.person_email or "",
        location=directory_person.person_location or "",
        role=getattr(directory_person, "role", None),
        directorFirst=prev_dir.get("firstName") or None,
        directorLast=prev_dir.get("lastName") or None,
    )

    # Update the Directory row in-place.
    directory_person.person_first_name = (final_values.firstName or "").strip()
    directory_person.person_last_name = (final_values.lastName or "").strip()
    directory_person.person_email = (final_values.email or "").strip()
    directory_person.person_location = (final_values.location or "").strip()
    if hasattr(final_values, "role") and final_values.role is not None:
        directory_person.role = (final_values.role or "").strip() or None
    if getattr(final_values, "directorFirst", None) is not None or getattr(final_values, "directorLast", None) is not None:
        from app.intake_persons import set_director_fields
        set_director_fields(
            directory_person,
            getattr(final_values, "directorFirst", None) or "",
            getattr(final_values, "directorLast", None) or "",
        )

    from app.intake_persons import append_lifecycle_history, get_lifecycle_history
    from app.manager_request_tags import TAG_REMOVED
    
    existing_stored = get_lifecycle_history(directory_person)
    existing_stored_ids = {e.get("id") for e in existing_stored}

    manager_source = _current_request_member(
        members,
        source_request_id=source_request_id,
        representative_request_id=group.representative_request_id,
    )
    source_action = (manager_source.action if manager_source else None) or "Add"

    # Active Directory only:
    # - Remove request → archive + update fields
    # - Add request → update fields; stay active (bump handled_at so Directory sorts it current)
    history_title = "Directory record updated"
    directory_person.handled_at = now
    if source_action == "Remove":
        directory_person.action = "Remove"
        directory_person.outcome = "Removed"
        directory_person.archived_at = now
        if TAG_REMOVED not in (directory_person.tags or []):
            directory_person.tags = list(directory_person.tags or []) + [TAG_REMOVED]
            flag_modified(directory_person, "tags")
        history_title = "Moved to archive"
    else:
        directory_person.action = "Add"
        directory_person.outcome = "Added"
        directory_person.archived_at = None

    snapshot_events = _snapshot_discarded_manager_requests(directory_person, members, existing_stored_ids)

    # Add explicit Update Directory event
    from app.request_display import parse_request_display_number
    dir_display_id = parse_request_display_number(directory_person.id)

    from app.user_display import POWER_MUSIC_ADMIN_DISPLAY_NAME

    update_event_id = f"{directory_person.id}-update-{now.timestamp()}"
    snapshot_events.append({
        "id": update_event_id,
        "type": "handled",
        "at": now.isoformat(),
        "requestId": directory_person.id,
        "displayId": dir_display_id,
        "action": directory_person.action,
        "title": history_title,
        "detail": f"By {POWER_MUSIC_ADMIN_DISPLAY_NAME}",
        "handledBy": POWER_MUSIC_ADMIN_DISPLAY_NAME,
        "outcome": directory_person.outcome,
    })

    if snapshot_events:
        append_lifecycle_history(directory_person, snapshot_events)
    _apply_merge_manager_provenance(
        directory_person, manager_source, final_values=final_values
    )

    if admin_note:
        directory_person.admin_notes = admin_note

    # Fold snapshot peers into the Directory row (not late arrivals).
    discarded_ids = [m.id for m in members if m.id != directory_person.id]
    # Unconditional: also syncs requests merged into this row earlier.
    merge_requests_into(db, discarded_ids, directory_person)

    # Clear representative pointer since snapshot member requests are deleted
    group.representative_request_id = None
    group.directory_person_id = directory_person.id

    # Stamp audit metadata and close the group.
    _finalize_group(
        db, group,
        resolution_type="update",
        final_values=final_values,
        previous_values=previous,
        admin_id=admin_id,
        admin_note=admin_note,
        now=now,
    )
    db.flush()
    _detach_and_regroup_late_arrivals(db, late_arrivals, exclude_id=directory_person.id)
    return directory_person


# ── Case C: Resolve — Keep Existing ─────────────────────────────────────────


def resolve_group_keep_existing(
    db: Session,
    group: models.DuplicateGroup,
    *,
    admin_id: Optional[str],
    admin_note: Optional[str] = None,
    member_ids: Optional[List[str]] = None,
) -> int:
    """Resolve group without modifying the Directory; permanently delete snapshot incoming requests.

    Invariants:
    - Directory record is left completely unchanged.
    - Snapshot member requests are permanently deleted.
    - Late arrivals (``member_ids``) stay open and re-group against Directory.
    - Does NOT call db.commit() — router commits.

    Returns the count of requests deleted.
    """
    now = datetime.now(timezone.utc)
    all_members = get_group_members(db, group.id)
    members, late_arrivals = _members_for_resolve_snapshot(all_members, member_ids)

    from app.intake_persons import append_lifecycle_history, get_lifecycle_history
    directory_person = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == group.directory_person_id).first()
    if directory_person:
        from app.user_display import hydrate_request_users
        hydrate_request_users(db, members + late_arrivals + [directory_person])
        existing_stored = get_lifecycle_history(directory_person)
        existing_stored_ids = {e.get("id") for e in existing_stored}
        snapshot_events = _snapshot_discarded_manager_requests(directory_person, members, existing_stored_ids)
        if snapshot_events:
            append_lifecycle_history(directory_person, snapshot_events)

    discarded_ids = [m.id for m in members if m.id != group.directory_person_id]
    count = len(discarded_ids)

    # Unconditional: also syncs requests merged into this row earlier.
    merge_requests_into(db, discarded_ids, directory_person)

    group.representative_request_id = None

    _finalize_group(
        db, group,
        resolution_type="keep_existing",
        final_values=None,
        previous_values=None,
        admin_id=admin_id,
        admin_note=admin_note,
        now=now,
    )
    db.flush()
    _detach_and_regroup_late_arrivals(db, late_arrivals)
    return count


# ── Case D: Resolve & Delete from Directory ──────────────────────────────────


def resolve_group_delete_from_directory(
    db: Session,
    group: models.DuplicateGroup,
    directory_person: models.ManagerRequest,
    *,
    final_values: schemas.PersonInfo,
    admin_id: Optional[str],
    admin_note: Optional[str] = None,
    source_request_id: Optional[str] = None,
    member_ids: Optional[List[str]] = None,
) -> int:
    """Resolve group by archiving an active Directory person and deleting incoming requests.

    Only Added/Active Directory rows may be targeted. Archived/Removed rows are
    left unchanged (callers should not offer them as selectable targets).

    Invariants:
    - Preserves the Add lifecycle events into intake_persons["history"] BEFORE mutating.
    - Updates the directory_person with final_values.
    - Sets outcome="Removed", action="Remove", handled_at=now, archived_at=now.
    - Permanently deletes snapshot incoming member requests.
    - Late arrivals (``member_ids``) stay open and re-group against the Removed Directory.
    - Does NOT call db.commit() — router commits.

    Returns the count of requests processed.
    """
    from app.intake_persons import append_lifecycle_history, get_lifecycle_history
    from app.user_display import resolve_handled_by_name, resolve_manager_name
    from app.request_display import parse_request_display_number
    from app.manager_request_tags import TAG_PARTNER_REQUEST, TAG_VERIFIED, has_tag as _has_tag

    if _directory_is_off_roster(directory_person) or (directory_person.outcome or "") != "Added":
        raise ValueError(
            "Archived or removed Directory records cannot be selected for Remove "
            "and Update. Choose an active Directory record, or use Keep Existing."
        )

    now = datetime.now(timezone.utc)

    all_members = get_group_members(db, group.id)
    members, late_arrivals = _members_for_resolve_snapshot(all_members, member_ids)
    from app.user_display import hydrate_request_users
    hydrate_request_users(db, members + late_arrivals + [directory_person])

    # ── Step 1: Snapshot existing Add lifecycle events before mutating ──────────
    # The directory_person row currently represents the Add event.  Once we
    # overwrite action/outcome/handled_at, that information would be lost.
    # We freeze it into intake_persons["history"] so the history builder can
    # always reconstruct the full Add → Remove timeline from a single row.
    existing_stored = get_lifecycle_history(directory_person)
    existing_stored_ids = {e.get("id") for e in existing_stored}

    snapshot_events: list = []
    dir_tags = directory_person.tags or []
    dir_display_id = parse_request_display_number(directory_person.id)
    dir_action = directory_person.action or ""
    dir_action_verb = "add" if dir_action == "Add" else "remove" if dir_action == "Remove" else dir_action.lower()
    dir_manager_name = resolve_manager_name(directory_person)
    dir_handled_by = resolve_handled_by_name(directory_person)

    # Manager request event
    has_manager = (
        _has_tag(dir_tags, TAG_PARTNER_REQUEST)
        or _has_tag(dir_tags, TAG_VERIFIED)
        or bool(directory_person.manager_id)
    )
    if has_manager and directory_person.received_at:
        is_admin_entry = not directory_person.manager_id and _has_tag(dir_tags, TAG_PARTNER_REQUEST)
        who = dir_manager_name or ("an admin" if is_admin_entry else "a manager")
        title_prefix = "Admin entry" if is_admin_entry else "Manager request"
        event_id = f"{directory_person.id}-manager-request"
        if event_id not in existing_stored_ids:
            snapshot_events.append({
                "id": event_id,
                "type": "manager_request",
                "at": directory_person.received_at.isoformat() if hasattr(directory_person.received_at, "isoformat") else str(directory_person.received_at),
                "requestId": directory_person.id,
                "displayId": dir_display_id,
                "action": dir_action,
                "title": f"{title_prefix} to {dir_action_verb or 'update'}",
                "detail": f"Submitted by {who}",
                "managerName": dir_manager_name or ("Admin" if is_admin_entry else None),
            })

    # Handled (Added) event — use "-handled-add" suffix so it does NOT clash
    # with the live-derivation ID "{id}-handled" that will be generated after
    # the row is mutated.  If they shared the same ID the dedup set would
    # suppress whichever came second (the "Marked as Removed" event).
    if directory_person.status == "handled" and directory_person.handled_at:
        outcome_label = directory_person.outcome or dir_action
        event_id = f"{directory_person.id}-handled-add"
        if event_id not in existing_stored_ids:
            snapshot_events.append({
                "id": event_id,
                "type": "handled",
                "at": directory_person.handled_at.isoformat() if hasattr(directory_person.handled_at, "isoformat") else str(directory_person.handled_at),
                "requestId": directory_person.id,
                "displayId": dir_display_id,
                "action": dir_action,
                "title": f"Marked as {outcome_label}",
                "detail": f"By {dir_handled_by}" if dir_handled_by else None,
                "handledBy": dir_handled_by or None,
                "outcome": outcome_label,
            })

    snapshot_events.extend(_snapshot_discarded_manager_requests(directory_person, members, existing_stored_ids))

    # Append all snapshot events captured so far (Add lifecycle + Remove requests).
    if snapshot_events:
        append_lifecycle_history(directory_person, snapshot_events)

    # ── Step 2: Nullify references in other DuplicateGroups ────────────────────
    from sqlalchemy import update
    db.execute(
        update(models.DuplicateGroup)
        .where(
            models.DuplicateGroup.directory_person_id == directory_person.id,
            models.DuplicateGroup.id != group.id,
        )
        .values(directory_person_id=None)
    )

    # ── Step 3: Mutate the directory record to Removed ─────────────────────────
    directory_person.person_first_name = (final_values.firstName or "").strip()
    directory_person.person_last_name = (final_values.lastName or "").strip()
    directory_person.person_email = (final_values.email or "").strip()
    directory_person.person_location = (final_values.location or "").strip()
    if hasattr(final_values, "role") and final_values.role is not None:
        directory_person.role = (final_values.role or "").strip() or None
    if getattr(final_values, "directorFirst", None) is not None or getattr(final_values, "directorLast", None) is not None:
        from app.intake_persons import set_director_fields
        set_director_fields(
            directory_person,
            getattr(final_values, "directorFirst", None) or "",
            getattr(final_values, "directorLast", None) or "",
        )
    
    manager_source = _current_request_member(
        members,
        source_request_id=source_request_id,
        representative_request_id=group.representative_request_id,
    )
    _apply_merge_manager_provenance(directory_person, manager_source, final_values=final_values)
    
    directory_person.outcome = "Removed"
    directory_person.action = "Remove"
    directory_person.handled_at = now  # Record the actual removal time
    directory_person.archived_at = now

    from app.manager_request_tags import TAG_REMOVED
    if TAG_REMOVED not in (directory_person.tags or []):
        directory_person.tags = (directory_person.tags or []) + [TAG_REMOVED]

    if admin_note:
        directory_person.admin_notes = admin_note

    # ── Step 4: Freeze the "Marked as Removed" event with the correct timestamp ─
    # The live history-builder will also try to emit "{id}-handled" for the
    # mutated row, but since the same ID was already stored (via Step 1 stored
    # history OR via this explicit entry), the seen-set dedup will skip it.
    # Using a distinct "-handled-remove" suffix ensures the dedup set never
    # accidentally suppresses this event using the "-handled-add" or bare
    # "-handled" IDs written above.
    remove_event_id = f"{directory_person.id}-handled-remove"
    all_stored_ids = {e.get("id") for e in get_lifecycle_history(directory_person)}
    if remove_event_id not in all_stored_ids:
        append_lifecycle_history(directory_person, [{
            "id": remove_event_id,
            "type": "handled",
            "at": now.isoformat(),
            "requestId": directory_person.id,
            "displayId": dir_display_id,
            "action": "Remove",
            "title": "Marked as Removed",
            "detail": f"By {dir_handled_by}" if dir_handled_by else None,
            "handledBy": dir_handled_by or None,
            "outcome": "Removed",
        }])

    discarded_ids = [m.id for m in members if m.id != directory_person.id]
    count = len(discarded_ids)

    # Unconditional: also syncs requests merged into this row earlier.
    merge_requests_into(db, discarded_ids, directory_person)

    group.representative_request_id = None
    group.directory_person_id = directory_person.id

    _finalize_group(
        db, group,
        resolution_type="delete",
        final_values=final_values,
        previous_values=None,
        admin_id=admin_id,
        admin_note=admin_note,
        now=now,
    )
    db.flush()
    _detach_and_regroup_late_arrivals(db, late_arrivals, exclude_id=directory_person.id)
    return count


# ── Case E: Resolve & Mark as Removed ────────────────────────────────────────


def resolve_group_mark_removed(
    db: Session,
    group: models.DuplicateGroup,
    *,
    final_values: schemas.PersonInfo,
    admin_id: Optional[str],
    partner_id: Optional[str] = None,
    admin_note: Optional[str] = None,
    source_request_id: Optional[str] = None,
    member_ids: Optional[List[str]] = None,
) -> int:
    """Resolve group and retain representative request as Removed Directory record (Case E), deleting discarded requests.

    Invariants:
    - Retains representative / source request, updating it to status='handled', outcome='Removed', action='Remove'.
    - Permanently deletes other snapshot member requests.
    - Late arrivals (``member_ids``) stay open and re-group against the Removed Directory.
    - Does NOT call db.commit() — router commits.

    Returns the count of requests processed.
    """
    now = datetime.now(timezone.utc)
    all_members = get_group_members(db, group.id)
    members, late_arrivals = _members_for_resolve_snapshot(all_members, member_ids)
    retained_req = _current_request_member(
        members,
        source_request_id=source_request_id,
        representative_request_id=group.representative_request_id,
    )
    if retained_req is None and members:
        members_sorted = sorted(
            members,
            key=lambda r: (_norm_dt(r.received_at), r.id or ""),
            reverse=True,
        )
        retained_req = members_sorted[0]

    from app.user_display import hydrate_request_users
    hydrate_request_users(db, members + late_arrivals)

    admin_uuid = None
    if admin_id and admin_id != "dev-bypass":
        try:
            from uuid import UUID
            admin_uuid = UUID(admin_id)
        except ValueError:
            pass

    from app.manager_request_stats import decrement_manager_pending_stat
    from app.manager_request_summary_cache import invalidate_manager_request_summary
    from app.manager_request_tags import TAG_VERIFIED, TAG_PARTNER_REQUEST, TAG_REMOVED

    if retained_req:
        dir_row = retained_req
        was_new = dir_row.status == "new"
        dir_row.status = "handled"
        dir_row.outcome = "Removed"
        dir_row.action = "Remove"
        dir_row.handled_at = now
        dir_row.person_first_name = (final_values.firstName or "").strip()
        dir_row.person_last_name = (final_values.lastName or "").strip()
        dir_row.person_email = (final_values.email or "").strip()
        dir_row.person_location = (final_values.location or "").strip()
        if hasattr(final_values, "role") and final_values.role is not None:
            dir_row.role = (final_values.role or "").strip() or None
        if getattr(final_values, "directorFirst", None) is not None or getattr(final_values, "directorLast", None) is not None:
            from app.intake_persons import set_director_fields
            set_director_fields(
                dir_row,
                getattr(final_values, "directorFirst", None) or "",
                getattr(final_values, "directorLast", None) or "",
            )
        dir_row.archived_at = now
        
        manager_source = _current_request_member(
            members,
            source_request_id=source_request_id,
            representative_request_id=group.representative_request_id,
        )
        _apply_merge_manager_provenance(dir_row, manager_source, final_values=final_values)
        
        if admin_uuid:
            dir_row.handled_by_admin_id = admin_uuid
        if admin_note:
            dir_row.admin_notes = admin_note
        _clear_duplicate_tags(dir_row)
        dir_row.tags = (dir_row.tags or []) + [TAG_REMOVED]
        dir_row.duplicate_group_id = None
        if was_new:
            decrement_manager_pending_stat(db, dir_row)
            if dir_row.manager_id:
                invalidate_manager_request_summary(str(dir_row.manager_id))
    else:
        from app.request_display import allocate_request_ids
        (new_id,) = allocate_request_ids(db, 1)
        dir_row = models.ManagerRequest(
            id=new_id,
            received_at=now,
            handled_at=now,
            status="handled",
            outcome="Removed",
            action="Remove",
            person_first_name=(final_values.firstName or "").strip(),
            person_last_name=(final_values.lastName or "").strip(),
            person_email=(final_values.email or "").strip(),
            person_location=(final_values.location or "").strip(),
            role=(final_values.role or "").strip() or None if hasattr(final_values, "role") and final_values.role else None,
            tags=[TAG_VERIFIED, TAG_PARTNER_REQUEST, TAG_REMOVED],
            partner_id=partner_id or group.partner_id,
            archived_at=now,
        )
        if getattr(final_values, "directorFirst", None) is not None or getattr(final_values, "directorLast", None) is not None:
            from app.intake_persons import set_director_fields
            set_director_fields(
                dir_row,
                getattr(final_values, "directorFirst", None) or "",
                getattr(final_values, "directorLast", None) or "",
            )
        if admin_uuid:
            dir_row.handled_by_admin_id = admin_uuid
        if admin_note:
            dir_row.admin_notes = admin_note
        db.add(dir_row)
        db.flush()

    discarded_ids = [m.id for m in members if m.id != dir_row.id]
    # Unconditional: also syncs requests merged into this row earlier.
    merge_requests_into(db, discarded_ids, dir_row)

    group.directory_person_id = dir_row.id
    group.representative_request_id = dir_row.id

    _finalize_group(
        db, group,
        resolution_type="mark_removed",
        final_values=final_values,
        previous_values=None,
        admin_id=admin_id,
        admin_note=admin_note,
        now=now,
    )
    db.flush()
    _detach_and_regroup_late_arrivals(db, late_arrivals, exclude_id=dir_row.id)
    return len(members) or 1


# ── Preview helper (no writes) ───────────────────────────────────────────────

_FIELD_LABELS = {
    "firstName": "First Name",
    "lastName": "Last Name",
    "email": "Email",
    # label "Location" for PureGym; "Client" for Health Fitness — applied at
    # the presentation layer by the frontend based on partner context.
    "location": "Location",
}


def preview_resolve_update(
    directory_person: models.ManagerRequest,
    final_values: schemas.PersonInfo,
) -> dict:
    """Return a side-by-side diff of current vs proposed Directory values. No DB writes."""
    current = {
        "firstName": directory_person.person_first_name or "",
        "lastName": directory_person.person_last_name or "",
        "email": directory_person.person_email or "",
        "location": directory_person.person_location or "",
    }
    proposed = {
        "firstName": (final_values.firstName or "").strip(),
        "lastName": (final_values.lastName or "").strip(),
        "email": (final_values.email or "").strip(),
        "location": (final_values.location or "").strip(),
    }

    field_diffs = []
    any_changed = False
    for key, label in _FIELD_LABELS.items():
        changed = current[key] != proposed[key]
        if changed:
            any_changed = True
        field_diffs.append({
            "field": key,
            "label": label,
            "currentValue": current[key],
            "proposedValue": proposed[key],
            "changed": changed,
        })

    return {
        "directoryPersonId": directory_person.id,
        "currentValues": schemas.PersonInfo(
            firstName=current["firstName"],
            lastName=current["lastName"],
            email=current["email"],
            location=current["location"],
        ),
        "proposedValues": final_values,
        "fields": field_diffs,
        "anyChanged": any_changed,
    }


def backfill_duplicate_groups(db: Session, dry_run: bool = False) -> dict:
    """Evaluate all existing unhandled requests under duplicate/Directory matching rules.

    Assigns duplicate_group_id, creates DuplicateGroup records, and syncs tags.
    If dry_run=True, performs calculations in a transaction and rolls back at the end.
    """
    unhandled_requests = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.status == "new")
        .order_by(models.ManagerRequest.received_at.asc(), models.ManagerRequest.id.asc())
        .all()
    )

    initial_grouped_ids = {r.id for r in unhandled_requests if r.duplicate_group_id is not None}
    initial_already_exists_ids = {r.id for r in unhandled_requests if TAG_ALREADY_EXISTS in (r.tags or [])}
    initial_needs_review_ids = {
        r.id
        for r in unhandled_requests
        if any(
            t in (r.tags or [])
            for t in (TAG_ALREADY_EXISTS, TAG_CONFIRMED_DUPLICATE, TAG_POTENTIAL_DUPLICATE)
        )
    }

    # Pre-build candidate index to avoid N^2 DB round-trips
    name_counts = {}
    email_counts = {}
    prefix_counts = {}
    for req in unhandled_requests:
        f_name = (req.person_first_name or "").strip().lower()
        l_name = (req.person_last_name or "").strip().lower()
        l_email = (req.person_email or "").strip().lower()
        if l_name:
            name_counts[l_name] = name_counts.get(l_name, 0) + 1
        if l_email:
            email_counts[l_email] = email_counts.get(l_email, 0) + 1
        if len(f_name) >= 3 and len(l_name) >= 3:
            pf = f_name[:3] + "_" + l_name[:3]
            prefix_counts[pf] = prefix_counts.get(pf, 0) + 1

    directory_rows = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.status == "handled",
            models.ManagerRequest.outcome == "Added",
            models.ManagerRequest.archived_at.is_(None),
        )
        .all()
    )
    dir_last_names = {(d.person_last_name or "").strip().lower() for d in directory_rows if d.person_last_name}
    dir_emails = {(d.person_email or "").strip().lower() for d in directory_rows if d.person_email}
    dir_prefixes = {
        (d.person_first_name or "").strip().lower()[:3] + "_" + (d.person_last_name or "").strip().lower()[:3]
        for d in directory_rows
        if (d.person_first_name or "").strip() and len((d.person_first_name or "").strip()) >= 3
        and (d.person_last_name or "").strip() and len((d.person_last_name or "").strip()) >= 3
    }

    dismissed_set = get_all_dismissed_pairs(db)
    groups_created = []

    for req in unhandled_requests:
        if req.duplicate_group_id:
            continue

        f_name = (req.person_first_name or "").strip().lower()
        l_name = (req.person_last_name or "").strip().lower()
        l_email = (req.person_email or "").strip().lower()
        pf = (f_name[:3] + "_" + l_name[:3]) if (len(f_name) >= 3 and len(l_name) >= 3) else None

        # Check if there is any candidate peer or directory match
        has_peer = (
            (l_name and name_counts.get(l_name, 0) > 1)
            or (l_email and email_counts.get(l_email, 0) > 1)
            or (pf and prefix_counts.get(pf, 0) > 1)
        )
        has_dir = (
            (l_name and l_name in dir_last_names)
            or (l_email and l_email in dir_emails)
            or (pf and pf in dir_prefixes)
        )

        if not has_peer and not has_dir:
            continue

        group = process_request_grouping(
            db,
            req,
            pending_candidates=unhandled_requests,
            directory_candidates=directory_rows,
            dismissed_set=dismissed_set,
        )
        if group and group not in groups_created:
            groups_created.append(group)

    final_unhandled = unhandled_requests

    final_grouped_ids = {r.id for r in final_unhandled if r.duplicate_group_id is not None}
    final_already_exists_ids = {r.id for r in final_unhandled if TAG_ALREADY_EXISTS in (r.tags or [])}
    final_needs_review_ids = {
        r.id
        for r in final_unhandled
        if any(
            t in (r.tags or [])
            for t in (TAG_ALREADY_EXISTS, TAG_CONFIRMED_DUPLICATE, TAG_POTENTIAL_DUPLICATE)
        )
    }

    newly_grouped = final_grouped_ids - initial_grouped_ids
    newly_already_exists = final_already_exists_ids - initial_already_exists_ids
    newly_needs_review = final_needs_review_ids - initial_needs_review_ids

    sample_groupings = []
    for g in groups_created[:10]:
        members = [m for m in unhandled_requests if m.duplicate_group_id == g.id]
        sample_groupings.append({
            "group_id": g.id,
            "classification": g.classification,
            "directory_person_id": g.directory_person_id,
            "representative_request_id": g.representative_request_id,
            "member_count": len(members),
            "members": [
                {
                    "id": m.id,
                    "name": f"{m.person_first_name} {m.person_last_name}",
                    "email": m.person_email,
                    "received_at": m.received_at.isoformat() if m.received_at else None,
                }
                for m in members
            ],
        })

    summary = {
        "dry_run": dry_run,
        "total_unhandled_requests_scanned": len(unhandled_requests),
        "requests_newly_grouped": len(newly_grouped),
        "requests_newly_flagged_already_exists": len(newly_already_exists),
        "requests_newly_flagged_needs_review": len(newly_needs_review),
        "total_groups_created": len(groups_created),
        "sample_groupings": sample_groupings,
    }

    if dry_run:
        db.rollback()
    else:
        db.commit()

    return summary

