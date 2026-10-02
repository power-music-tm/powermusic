"""Automated regression tests for duplicate group request deletion.

Ensures that deleting an individual request from inside a duplicate group:
1. Strictly cascades ONLY to exact field-for-field confirmed duplicates of the selected request.
2. NEVER accidentally deletes the group's representative unless it is an exact confirmed duplicate.
3. Automatically recalculates the representative and group classification after deletion.
4. Correctly dissociates dismissed requests (duplicate_group_id is None, tags cleared).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import SessionLocal
from app.duplicate_group_service import (
    _new_group_id,
    _sync_group_representative_and_tags,
    collect_selective_dismiss_targets,
    finalize_group_after_selective_dismiss,
    get_dismiss_impact,
    get_group_members,
)
from app.manager_request_tags import (
    TAG_CONFIRMED_DUPLICATE,
    TAG_POTENTIAL_DUPLICATE,
)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
        session.rollback()
    finally:
        session.close()


def _create_request(
    db: Session,
    *,
    first_name: str,
    last_name: str,
    email: str,
    location: str,
    received_at: datetime,
    status: str = "new",
    action: str = "Add",
) -> models.ManagerRequest:
    req = models.ManagerRequest(
        id=f"test-del-{uuid.uuid4().hex[:10]}",
        received_at=received_at,
        handled_at=None,
        manager_id=None,
        handled_by_admin_id=None,
        person_first_name=first_name,
        person_last_name=last_name,
        person_email=email,
        person_location=location,
        action=action,
        manager_notes="",
        admin_notes="",
        tags=[],
        status=status,
        outcome=None,
        duplicate_group_id=None,
    )
    db.add(req)
    db.flush()
    return req


def _create_group(
    db: Session,
    requests: list[models.ManagerRequest],
    classification: str = "confirmed_duplicate",
) -> models.DuplicateGroup:
    now = datetime.now(timezone.utc)
    group = models.DuplicateGroup(
        id=_new_group_id(),
        partner_id=None,
        classification=classification,
        status="active",
        created_at=now,
        directory_person_id=None,
        representative_request_id=None,
    )
    db.add(group)
    db.flush()

    for r in requests:
        r.duplicate_group_id = group.id

    _sync_group_representative_and_tags(db, group, member_requests=requests)
    db.flush()
    return group


def _dismiss_request_logic(
    db: Session,
    target_req: models.ManagerRequest,
    admin_id: str = "dev-bypass",
) -> tuple[list[models.ManagerRequest], list[models.ManagerRequest]]:
    """Helper simulating the complete dismiss_request router logic."""
    group_id = target_req.duplicate_group_id
    requests_to_dismiss, survivors = collect_selective_dismiss_targets(db, target_req)

    now = datetime.now(timezone.utc)
    for r in requests_to_dismiss:
        if r.status == "dismissed":
            continue
        r.status = "dismissed"
        r.handled_at = now
        r.duplicate_group_id = None
        r.tags = []

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
                {s.id for s in survivors},
                admin_id,
            )

    db.flush()
    return requests_to_dismiss, survivors


class TestGroupRequestDeletion:
    def test_delete_older_request_representative_different_survives(self, db: Session):
        """Test 1: Delete older request; representative is different and not an exact duplicate.

        Expected: older request deleted, representative remains in group, group stays active.
        """
        t0 = datetime.now(timezone.utc) - timedelta(days=2)
        t1 = datetime.now(timezone.utc) - timedelta(days=1)
        t2 = datetime.now(timezone.utc)

        r_66 = _create_request(db, first_name="John", last_name="Doe", email="john@example.com", location="London", received_at=t0)
        r_100 = _create_request(db, first_name="Jon", last_name="Doe", email="jon@example.com", location="London", received_at=t1)
        r_101 = _create_request(db, first_name="Jonathan", last_name="Doe", email="johnathan@example.com", location="London", received_at=t2)

        group = _create_group(db, [r_66, r_100, r_101], classification="potential_duplicate")
        assert group.representative_request_id == r_101.id

        # Delete older request r_100
        dismissed, survivors = _dismiss_request_logic(db, r_100)

        assert [d.id for d in dismissed] == [r_100.id]
        assert {s.id for s in survivors} == {r_66.id, r_101.id}

        db.refresh(r_100)
        db.refresh(r_101)
        db.refresh(r_66)
        db.refresh(group)

        assert r_100.status == "dismissed"
        assert r_100.duplicate_group_id is None

        # Representative r_101 must survive and remain representative
        assert r_101.status == "new"
        assert r_101.duplicate_group_id == group.id
        assert r_66.status == "new"
        assert r_66.duplicate_group_id == group.id

        assert group.status == "active"
        assert group.representative_request_id == r_101.id

        # Members list query returns only active survivors
        active_members = get_group_members(db, group.id)
        assert [m.id for m in active_members] == [r_66.id, r_101.id]

    def test_delete_older_request_representative_is_exact_duplicate(self, db: Session):
        """Test 2: Delete older request; representative is an exact duplicate.

        Expected: older request deleted, representative deleted as confirmed duplicate,
        and latest remaining survivor becomes representative (or single-member dissolution).
        """
        t0 = datetime.now(timezone.utc) - timedelta(days=3)
        t1 = datetime.now(timezone.utc) - timedelta(days=2)
        t2 = datetime.now(timezone.utc) - timedelta(days=1)
        t3 = datetime.now(timezone.utc)

        # r_50 and r_66 are potential duplicates; r_100 and r_101 are exact confirmed duplicates
        r_50 = _create_request(db, first_name="Johnny", last_name="Smith", email="jsmith@example.com", location="London", received_at=t0)
        r_66 = _create_request(db, first_name="Jon", last_name="Smith", email="jsmith@example.com", location="London", received_at=t1)
        r_100 = _create_request(db, first_name="John", last_name="Smith", email="jsmith@example.com", location="London", received_at=t2)
        r_101 = _create_request(db, first_name="John", last_name="Smith", email="jsmith@example.com", location="London", received_at=t3)

        group = _create_group(db, [r_50, r_66, r_100, r_101])
        assert group.representative_request_id == r_101.id

        # Delete r_100 (which has exact confirmed duplicate r_101)
        dismissed, survivors = _dismiss_request_logic(db, r_100)

        assert {d.id for d in dismissed} == {r_100.id, r_101.id}
        assert {s.id for s in survivors} == {r_50.id, r_66.id}

        db.refresh(r_100)
        db.refresh(r_101)
        db.refresh(r_66)
        db.refresh(r_50)
        db.refresh(group)

        assert r_100.status == "dismissed"
        assert r_101.status == "dismissed"
        assert r_100.duplicate_group_id is None
        assert r_101.duplicate_group_id is None

        # Remaining survivors r_50 and r_66 stay in group, new representative is r_66
        assert r_66.status == "new"
        assert r_50.status == "new"
        assert group.status == "active"
        assert group.representative_request_id == r_66.id

    def test_delete_request_with_both_confirmed_and_potential_duplicates(self, db: Session):
        """Test 3: Delete request with both confirmed and potential duplicates.

        Expected: confirmed duplicates deleted, potential duplicates remain.
        """
        t0 = datetime.now(timezone.utc) - timedelta(hours=3)
        t1 = datetime.now(timezone.utc) - timedelta(hours=2)
        t2 = datetime.now(timezone.utc) - timedelta(hours=1)
        t3 = datetime.now(timezone.utc)

        r_target = _create_request(db, first_name="Alice", last_name="Brown", email="alice@example.com", location="Leeds", received_at=t0)
        r_confirmed = _create_request(db, first_name="Alice", last_name="Brown", email="alice@example.com", location="Leeds", received_at=t1)
        r_pot1 = _create_request(db, first_name="Alyce", last_name="Brown", email="alice@example.com", location="Leeds", received_at=t2)
        r_pot2 = _create_request(db, first_name="Alice", last_name="Brown", email="alice@example.com", location="York", received_at=t3)

        group = _create_group(db, [r_target, r_confirmed, r_pot1, r_pot2])

        dismissed, survivors = _dismiss_request_logic(db, r_target)

        assert {d.id for d in dismissed} == {r_target.id, r_confirmed.id}
        assert {s.id for s in survivors} == {r_pot1.id, r_pot2.id}

        db.refresh(group)
        assert group.status == "active"
        assert group.representative_request_id == r_pot2.id

    def test_delete_representative(self, db: Session):
        """Test 4: Delete the representative.

        Expected: only representative + its exact confirmed duplicates deleted,
        remaining requests preserved, new representative calculated.
        """
        t0 = datetime.now(timezone.utc) - timedelta(hours=3)
        t1 = datetime.now(timezone.utc) - timedelta(hours=2)
        t2 = datetime.now(timezone.utc) - timedelta(hours=1)

        r_pot = _create_request(db, first_name="Bob", last_name="Taylor", email="btaylor@example.com", location="Manchester", received_at=t0)
        r_older_exact = _create_request(db, first_name="Robert", last_name="Taylor", email="robert@example.com", location="Manchester", received_at=t1)
        r_rep = _create_request(db, first_name="Robert", last_name="Taylor", email="robert@example.com", location="Manchester", received_at=t2)

        group = _create_group(db, [r_pot, r_older_exact, r_rep])
        assert group.representative_request_id == r_rep.id

        # Delete representative r_rep
        dismissed, survivors = _dismiss_request_logic(db, r_rep)

        assert {d.id for d in dismissed} == {r_rep.id, r_older_exact.id}
        assert {s.id for s in survivors} == {r_pot.id}

        db.refresh(r_rep)
        db.refresh(r_older_exact)
        db.refresh(r_pot)
        db.refresh(group)

        assert r_rep.status == "dismissed"
        assert r_older_exact.status == "dismissed"

        # r_pot was the sole survivor with no directory match -> group dissolved, r_pot is standalone
        assert r_pot.status == "new"
        assert r_pot.duplicate_group_id is None
        assert group.status == "dismissed"
        assert group.representative_request_id is None

    def test_multiple_exact_duplicates(self, db: Session):
        """Test 5: Multiple exact duplicates.

        Expected: all exact confirmed duplicates of selected request deleted,
        potential duplicates preserved, group recalculated.
        """
        t0 = datetime.now(timezone.utc) - timedelta(minutes=50)
        t1 = datetime.now(timezone.utc) - timedelta(minutes=40)
        t2 = datetime.now(timezone.utc) - timedelta(minutes=30)
        t3 = datetime.now(timezone.utc) - timedelta(minutes=20)
        t4 = datetime.now(timezone.utc) - timedelta(minutes=10)

        r1 = _create_request(db, first_name="Carol", last_name="Danvers", email="carol@marvel.com", location="Leeds", received_at=t0)
        r2_pot = _create_request(db, first_name="Carol", last_name="Danvers", email="carol@other.com", location="Leeds", received_at=t1)
        r3_exact = _create_request(db, first_name="Carol", last_name="Danvers", email="carol@marvel.com", location="Leeds", received_at=t2)
        r4_exact = _create_request(db, first_name="Carol", last_name="Danvers", email="carol@marvel.com", location="Leeds", received_at=t3)
        r5_pot = _create_request(db, first_name="Caroline", last_name="Danvers", email="carol@marvel.com", location="Leeds", received_at=t4)

        group = _create_group(db, [r1, r2_pot, r3_exact, r4_exact, r5_pot])

        # Delete r3_exact (exact matches: r1, r4_exact)
        dismissed, survivors = _dismiss_request_logic(db, r3_exact)

        assert {d.id for d in dismissed} == {r1.id, r3_exact.id, r4_exact.id}
        assert {s.id for s in survivors} == {r2_pot.id, r5_pot.id}

        db.refresh(group)
        assert group.status == "active"
        assert group.representative_request_id == r5_pot.id

        members = get_group_members(db, group.id)
        assert [m.id for m in members] == [r2_pot.id, r5_pot.id]

    def test_deleting_older_request_never_deletes_unrelated_newer_request(self, db: Session):
        """Test 6: Deleting an older request must NEVER delete an unrelated newer request merely because it belongs to the same group.

        Expected: only exact confirmed duplicates deleted, potential duplicates preserved.
        """
        t0 = datetime.now(timezone.utc) - timedelta(days=2)
        t1 = datetime.now(timezone.utc)

        r_older = _create_request(db, first_name="Dave", last_name="Miller", email="dmiller@example.com", location="London", received_at=t0)
        r_newer = _create_request(db, first_name="David", last_name="Miller", email="davidm@example.com", location="London", received_at=t1)

        group = _create_group(db, [r_older, r_newer], classification="potential_duplicate")
        assert group.representative_request_id == r_newer.id

        # Delete older request
        dismissed, survivors = _dismiss_request_logic(db, r_older)

        assert [d.id for d in dismissed] == [r_older.id]
        assert [s.id for s in survivors] == [r_newer.id]

        db.refresh(r_older)
        db.refresh(r_newer)
        assert r_older.status == "dismissed"
        assert r_newer.status == "new"

    def test_dismiss_impact_preview(self, db: Session):
        """Test 7: Dismiss impact preview accurately isolates confirmed vs potential duplicate siblings."""
        t0 = datetime.now(timezone.utc) - timedelta(minutes=30)
        t1 = datetime.now(timezone.utc) - timedelta(minutes=20)
        t2 = datetime.now(timezone.utc) - timedelta(minutes=10)

        r_target = _create_request(db, first_name="Emma", last_name="Watson", email="emma@cinema.com", location="Oxford", received_at=t0)
        r_exact = _create_request(db, first_name="Emma", last_name="Watson", email="emma@cinema.com", location="Oxford", received_at=t1)
        r_pot = _create_request(db, first_name="Em", last_name="Watson", email="em@cinema.com", location="Oxford", received_at=t2)

        _create_group(db, [r_target, r_exact, r_pot])

        impact = get_dismiss_impact(db, r_target.id)

        assert impact["requestId"] == r_target.id
        assert impact["confirmedSiblingIds"] == [r_exact.id]
        assert impact["confirmedSiblingCount"] == 1
        assert impact["potentialSiblingIds"] == [r_pot.id]
        assert impact["potentialSiblingCount"] == 1

    def test_router_dismiss_request_endpoint_preserves_representative(self, db: Session):
        """Test 8: Call dismiss_request API router endpoint directly and verify representative is preserved."""
        from app.api.routers.pilot1 import dismiss_request
        from app.api.auth import AuthenticatedUser

        t0 = datetime.now(timezone.utc) - timedelta(days=2)
        t1 = datetime.now(timezone.utc) - timedelta(days=1)
        t2 = datetime.now(timezone.utc)

        r_66 = _create_request(db, first_name="John", last_name="Doe", email="john@example.com", location="London", received_at=t0)
        r_100 = _create_request(db, first_name="Jon", last_name="Doe", email="jon@example.com", location="London", received_at=t1)
        r_101 = _create_request(db, first_name="Jonathan", last_name="Doe", email="johnathan@example.com", location="London", received_at=t2)

        group = _create_group(db, [r_66, r_100, r_101], classification="potential_duplicate")
        db.commit()

        admin_user = AuthenticatedUser(id="dev-bypass", email="admin@example.com", role="admin")

        # Call the actual dismiss_request router endpoint on r_100
        res = dismiss_request(request_id=r_100.id, db=db, admin=admin_user)
        assert res["id"] == r_100.id
        assert res["status"] == "dismissed"

        db.refresh(r_100)
        db.refresh(r_101)
        db.refresh(r_66)
        db.refresh(group)

        # r_100 is dismissed and unlinked
        assert r_100.status == "dismissed"
        assert r_100.duplicate_group_id is None

        # r_101 must still be active, still in group, and still be the representative
        assert r_101.status == "new"
        assert r_101.duplicate_group_id == group.id
        assert r_66.status == "new"
        assert r_66.duplicate_group_id == group.id
        assert group.status == "active"
        assert group.representative_request_id == r_101.id

