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
from typing import List, Optional, Set, Tuple
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app import models, schemas
from app.duplicate_matching import (
    are_requests_dismissed,
    get_all_dismissed_pairs,
    is_healthtech_from_request,
    is_gll_from_request,
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
    """Fetch handled directory rows for conflict detection matching last_name or email."""
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

    return q.order_by(models.ManagerRequest.handled_at.desc()).limit(limit).all()


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

    # ── Step 2: scan directory for an already-exists conflict ───────────────
    if directory_candidates is not None:
        dir_candidates = [
            c for c in directory_candidates
            if c.status == "handled" and c.outcome in ("Added", "Removed") and (not req.partner_id or c.partner_id == req.partner_id)
        ]
    else:
        dir_candidates = _directory_candidates(db, req)

    dir_match_person: Optional[models.ManagerRequest] = None
    dir_match_classification: Optional[str] = None

    for dir_cand in dir_candidates:
        if are_requests_dismissed(db, req.id, dir_cand.id, dismissed_set=dismissed_set):
            continue
        classification, _ = match_classification_for_partner(req_person, person_from_model(dir_cand), is_healthtech=is_ht, is_gll=is_gll)
        if classification:
            dir_match_person = dir_cand
            dir_match_classification = classification
            break

    # ── Step 3: determine final classification ──────────────────────────────
    if best_match_req and dir_match_person:
        final_classification = "already_removed_conflict" if dir_match_person.outcome == "Removed" else "already_exists_conflict"
    elif best_match_req:
        final_classification = best_group_classification
    elif dir_match_person:
        if dir_match_person.outcome == "Removed":
            final_classification = "already_removed" if dir_match_classification == "confirmed_duplicate" else "potential_duplicate"
        else:
            final_classification = "already_exists" if dir_match_classification == "confirmed_duplicate" else "potential_duplicate"
    else:
        return None  # No match found — no group needed

    # ── Step 4: join an existing group or create a new one ──────────────────

    # If the best-matching pending request is already in a group, join that group.
    if best_match_req and best_match_req.duplicate_group_id:
        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == best_match_req.duplicate_group_id)
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
            # Absorb any other ungrouped candidates into this group too.
            _absorb_ungrouped_matches(
                db, group, req_person, exclude_id=req.id, ungrouped_candidates=p_cands, is_healthtech=is_ht, is_gll=is_gll
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
    """Pull any still-ungrouped pending requests that match req_person into *group*."""
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

    for cand in candidates:
        if are_requests_dismissed(db, exclude_id or "", cand.id, dismissed_set=dismissed_set):
            continue
        if is_request_dismissed_from_group(db, cand.id, group.id):
            continue
        
        classification, score = match_classification_for_partner(req_person, person_from_model(cand), is_healthtech=is_healthtech, is_gll=is_gll)
        if classification:
            cand.duplicate_group_id = group.id
            upgraded = _best_classification(group.classification, classification)
            if upgraded != group.classification:
                group.classification = upgraded


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
            r.received_at or datetime.min.replace(tzinfo=timezone.utc),
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

            if dir_person.outcome == "Removed":
                if dir_classification == "confirmed_duplicate":
                    tags_to_add.append(TAG_ALREADY_REMOVED)
                elif dir_classification == "potential_duplicate":
                    if TAG_POTENTIAL_DUPLICATE not in tags_to_add:
                        tags_to_add.append(TAG_POTENTIAL_DUPLICATE)
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

    for member in cohort:
        if not are_requests_dismissed(db, request_id_1, member.id):
            db.add(
                models.DismissedDuplicateMatch(
                    id=f"dism-{uuid.uuid4().hex[:12]}",
                    request_id_1=request_id_1,
                    request_id_2=member.id,
                    dismissed_by_admin_id=admin_uuid,
                    created_at=now,
                )
            )
        if group.directory_person_id and member.id != group.directory_person_id:
            if not are_requests_dismissed(db, group.directory_person_id, member.id):
                db.add(
                    models.DismissedDuplicateMatch(
                        id=f"dism-{uuid.uuid4().hex[:12]}",
                        request_id_1=group.directory_person_id,
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
) -> Tuple[List[models.ManagerRequest], List[models.ManagerRequest]]:
    """Return (requests_to_dismiss, survivors_to_keep).

    Only dismisses the requested ``req``. All other active group members are survivors.
    """
    to_dismiss = [req]
    survivors: List[models.ManagerRequest] = []
    if not req.duplicate_group_id or req.status != "new":
        return to_dismiss, survivors

    survivors = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.duplicate_group_id == req.duplicate_group_id,
            models.ManagerRequest.status == "new",
            models.ManagerRequest.id != req.id,
        )
        .all()
    )
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
            if (dir_person and dir_person.outcome == "Removed")
            else "already_exists_conflict"
        )
    elif dir_match:
        new_class = (
            "already_removed"
            if (dir_person and dir_person.outcome == "Removed")
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
    return (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.duplicate_group_id == group_id,
            models.ManagerRequest.status == "new",
        )
        .order_by(models.ManagerRequest.received_at.asc(), models.ManagerRequest.id.asc())
        .all()
    )


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

    Reads the existing tags stored on each member request — these are set
    authoritatively at group-join time and reflect the actual classification
    of each request relative to the group at the moment it joined.

    Returns:
        {
            "alreadyExists": bool,      # True if group has a directory_person_id
            "duplicateCount": int,       # number of members tagged confirmed_duplicate
            "potentialCount": int,       # number of members tagged potential_duplicate
        }

    Design notes:
    - The initial request (R1) has no duplicate tag — it is simply the anchor.
      It does not contribute to either count.
    - Already Exists is a single flag derived from directory_person_id.
      It is never multiplied by the number of members.
    - Counts are read from stored tags rather than recomputed on-the-fly so
      that they always match what was calculated at join-time (e.g., for
      requests with typos that would score differently on a fresh comparison).
    """
    if members is None:
        members = get_group_members(db, group.id)

    duplicate_count = 0
    potential_count = 0

    for member in members:
        tags = set(member.tags or [])
        if TAG_CONFIRMED_DUPLICATE in tags:
            duplicate_count += 1
        elif TAG_POTENTIAL_DUPLICATE in tags:
            # elif: avoid double-counting if somehow both are present
            potential_count += 1

    already_exists = False
    already_removed = False
    if group.directory_person_id:
        dir_person = db.query(models.ManagerRequest).filter_by(id=group.directory_person_id).first()
        if dir_person and dir_person.outcome == "Removed":
            already_removed = True
        else:
            already_exists = True

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
    """The current request Merge was clicked on (explicit id → rep → newest)."""
    if not members:
        return None
    by_id = {m.id: m for m in members}
    if source_request_id and source_request_id in by_id:
        return by_id[source_request_id]
    if representative_request_id and representative_request_id in by_id:
        return by_id[representative_request_id]
    return max(
        members,
        key=lambda m: m.received_at or datetime.min.replace(tzinfo=timezone.utc),
    )


def _apply_merge_manager_provenance(
    dir_row: models.ManagerRequest,
    source: Optional[models.ManagerRequest],
    *,
    final_values: schemas.PersonInfo,
) -> None:
    """Copy manager attribution onto the single Directory row created by merge.

    Without this, Directory falls back to "Auto Email Request" because the merge
    row has no manager_id / submittedBy.
    """
    from app.intake_persons import get_admin_submitted_by, get_submitted_by_attribution
    from app.manager_request_tags import (
        TAG_PARTNER_REQUEST,
        TAG_SENT_BY_ADMIN,
        TAG_VERIFIED,
        has_tag,
    )
    from app.person_compare import person_to_mapping

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
        dir_row.source_gmail_message_id = source.source_gmail_message_id

        attributed = get_submitted_by_attribution(source)
        if any(attributed.values()):
            intake["submittedBy"] = attributed
        else:
            intake.pop("submittedBy", None)

        admin_submitted = get_admin_submitted_by(source)
        if any(admin_submitted.values()):
            intake["adminSubmittedBy"] = admin_submitted
        else:
            intake.pop("adminSubmittedBy", None)

        source_tags = source.tags or []
        if has_tag(source_tags, TAG_PARTNER_REQUEST) or source.manager_id:
            if TAG_PARTNER_REQUEST not in tags:
                tags.append(TAG_PARTNER_REQUEST)
        if has_tag(source_tags, TAG_SENT_BY_ADMIN) or (
            not source.manager_id and any(attributed.values())
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
    dir_row.tags = tags


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

    # Decrement manager pending stats for active requests being deleted
    from app.manager_request_stats import decrement_manager_pending_stat
    from app.manager_request_summary_cache import invalidate_manager_request_summary
    for r in rows:
        if r.status == "new":
            decrement_manager_pending_stat(db, r)
            if r.manager_id:
                invalidate_manager_request_summary(str(r.manager_id))

    # 1. Nullify references in DuplicateGroup
    db.execute(
        update(models.DuplicateGroup)
        .where(models.DuplicateGroup.directory_person_id.in_(actual_ids))
        .values(directory_person_id=None)
    )
    db.execute(
        update(models.DuplicateGroup)
        .where(models.DuplicateGroup.representative_request_id.in_(actual_ids))
        .values(representative_request_id=None)
    )

    # 2. Delete related DismissedDuplicateMatch rows
    db.execute(
        delete(models.DismissedDuplicateMatch)
        .where(
            or_(
                models.DismissedDuplicateMatch.request_id_1.in_(actual_ids),
                models.DismissedDuplicateMatch.request_id_2.in_(actual_ids),
            )
        )
    )

    # 3. Delete related DismissedGroupMatch rows
    db.execute(
        delete(models.DismissedGroupMatch)
        .where(models.DismissedGroupMatch.request_id.in_(actual_ids))
    )

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
) -> models.ManagerRequest:
    """Create ONE Directory record from final_values, resolve the group, and permanently delete discarded requests.

    Invariants:
    - Retains the representative / source request, updating it in-place to status="handled", outcome="Added".
    - Permanently deletes all other member requests in the group.
    - Stamps group resolution metadata, links directory_person_id, and sets status='resolved'.
    - Does NOT call db.commit() — router commits.

    Returns the Directory ManagerRequest row.
    """
    _validate_final_values(final_values)
    now = datetime.now(timezone.utc)

    members = get_group_members(db, group.id)
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
            key=lambda r: (r.received_at or datetime.min.replace(tzinfo=timezone.utc), r.id or ""),
            reverse=True,
        )
        retained_req = members_sorted[0]

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

    # Permanently delete discarded member requests
    discarded_ids = [m.id for m in members if m.id != dir_row.id]
    if discarded_ids:
        permanently_delete_requests(db, discarded_ids)

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
    return dir_row


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
) -> models.ManagerRequest:
    """Update the existing Directory record in-place with final_values; resolve group and permanently delete incoming requests.

    Invariants:
    - group.directory_person_id must equal directory_person.id (caller verifies).
    - Updates directory_person in-place.
    - Permanently deletes all incoming member requests in the group.
    - Does NOT call db.commit() — router commits.

    Returns the updated Directory ManagerRequest row.
    """
    _validate_final_values(final_values)
    now = datetime.now(timezone.utc)
    
    members = get_group_members(db, group.id)
    from app.user_display import hydrate_request_users
    hydrate_request_users(db, members + [directory_person])

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
    
    existing_stored = get_lifecycle_history(directory_person)
    existing_stored_ids = {e.get("id") for e in existing_stored}
    
    members = get_group_members(db, group.id)
    
    manager_source = _current_request_member(
        members,
        source_request_id=source_request_id,
        representative_request_id=group.representative_request_id,
    )
    if manager_source and manager_source.action == "Remove":
        directory_person.action = "Remove"
        directory_person.outcome = "Removed"
        directory_person.handled_at = now
        directory_person.archived_at = now
        from app.manager_request_tags import TAG_REMOVED
        if TAG_REMOVED not in (directory_person.tags or []):
            directory_person.tags = (directory_person.tags or []) + [TAG_REMOVED]

    snapshot_events = _snapshot_discarded_manager_requests(directory_person, members, existing_stored_ids)
    
    # Add explicit Update Directory event
    from app.request_display import parse_request_display_number
    dir_display_id = parse_request_display_number(directory_person.id)
    
    admin_name = "Power Music Admin"
    if admin_id and admin_id != "dev-bypass":
        from app.models import PowermusicUser
        try:
            from uuid import UUID
            uuid_val = UUID(admin_id)
            admin_user = db.query(PowermusicUser).filter(PowermusicUser.id == uuid_val).first()
            if admin_user:
                admin_name = f"{admin_user.first_name} {admin_user.last_name}".strip() or "Power Music Admin"
        except Exception:
            pass

    update_event_id = f"{directory_person.id}-update-{now.timestamp()}"
    snapshot_events.append({
        "id": update_event_id,
        "type": "handled",
        "at": now.isoformat(),
        "requestId": directory_person.id,
        "displayId": dir_display_id,
        "action": directory_person.action,
        "title": "Power Music Admin updated the directory record",
        "detail": f"By {admin_name}",
        "handledBy": admin_name,
        "outcome": directory_person.outcome,
    })
    
    if snapshot_events:
        append_lifecycle_history(directory_person, snapshot_events)
    _apply_merge_manager_provenance(
        directory_person, manager_source, final_values=final_values
    )

    if admin_note:
        directory_person.admin_notes = admin_note

    # Permanently delete all incoming member requests
    discarded_ids = [m.id for m in members if m.id != directory_person.id]
    if discarded_ids:
        permanently_delete_requests(db, discarded_ids)

    # Clear representative pointer since member requests are deleted
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
    return directory_person


# ── Case C: Resolve — Keep Existing ─────────────────────────────────────────


def resolve_group_keep_existing(
    db: Session,
    group: models.DuplicateGroup,
    *,
    admin_id: Optional[str],
    admin_note: Optional[str] = None,
) -> int:
    """Resolve group without modifying the Directory; permanently delete all incoming requests.

    Invariants:
    - Directory record is left completely unchanged.
    - Incoming member requests are permanently deleted.
    - Does NOT call db.commit() — router commits.

    Returns the count of requests deleted.
    """
    now = datetime.now(timezone.utc)
    members = get_group_members(db, group.id)
    
    from app.intake_persons import append_lifecycle_history, get_lifecycle_history
    directory_person = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == group.directory_person_id).first()
    if directory_person:
        from app.user_display import hydrate_request_users
        hydrate_request_users(db, members + [directory_person])
        existing_stored = get_lifecycle_history(directory_person)
        existing_stored_ids = {e.get("id") for e in existing_stored}
        snapshot_events = _snapshot_discarded_manager_requests(directory_person, members, existing_stored_ids)
        if snapshot_events:
            append_lifecycle_history(directory_person, snapshot_events)

    discarded_ids = [m.id for m in members if m.id != group.directory_person_id]
    count = len(discarded_ids)

    if discarded_ids:
        permanently_delete_requests(db, discarded_ids)

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
) -> int:
    """Resolve group by marking Directory person as Removed and permanently deleting incoming requests.

    Invariants:
    - Preserves the Add lifecycle events into intake_persons["history"] BEFORE mutating.
    - Updates the directory_person with final_values.
    - Sets outcome="Removed", action="Remove", handled_at=now, archived_at=None.
    - Permanently deletes all incoming member requests.
    - Does NOT call db.commit() — router commits.

    Returns the count of requests processed.
    """
    from app.intake_persons import append_lifecycle_history, get_lifecycle_history
    from app.user_display import resolve_handled_by_name, resolve_manager_name
    from app.request_display import parse_request_display_number
    from app.manager_request_tags import TAG_PARTNER_REQUEST, TAG_VERIFIED, has_tag as _has_tag

    now = datetime.now(timezone.utc)
    
    members = get_group_members(db, group.id)
    from app.user_display import hydrate_request_users
    hydrate_request_users(db, members + [directory_person])

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

    members = get_group_members(db, group.id)
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
    # mutated row, but since the same ID was already stored (via Step 1 frozen
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

    if discarded_ids:
        permanently_delete_requests(db, discarded_ids)

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
) -> int:
    """Resolve group and retain representative request as Removed Directory record (Case E), deleting discarded requests.

    Invariants:
    - Retains representative / source request, updating it to status='handled', outcome='Removed', action='Remove'.
    - Permanently deletes all other member requests in the group.
    - Does NOT call db.commit() — router commits.

    Returns the count of requests processed.
    """
    now = datetime.now(timezone.utc)
    members = get_group_members(db, group.id)
    retained_req = _current_request_member(
        members,
        representative_request_id=group.representative_request_id,
    )
    if retained_req is None and members:
        members_sorted = sorted(
            members,
            key=lambda r: (r.received_at or datetime.min.replace(tzinfo=timezone.utc), r.id or ""),
            reverse=True,
        )
        retained_req = members_sorted[0]

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
    if discarded_ids:
        permanently_delete_requests(db, discarded_ids)

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

