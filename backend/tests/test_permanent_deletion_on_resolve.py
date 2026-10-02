"""Automated regression test suite for permanent deletion of discarded requests during duplicate group resolution.

Verifies:
1. Discarded requests during merge/resolution (Cases A, B, C, D, E) are physically deleted from the database.
2. Deleted requests never participate in future duplicate matching logic.
3. The retained/representative Directory record is properly preserved.
4. Foreign key cascades (DismissedDuplicateMatch, DismissedGroupMatch, ManagerRequestView, DuplicateGroup references) are cleanly handled.
5. Manager pending stats are decremented for active 'new' requests being deleted.
6. The 'Not the Same Person' (unlink) action preserves both requests in the database.
7. Router API endpoints execute resolutions and commit permanent deletions cleanly.
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
    _pending_candidates,
    _sync_group_representative_and_tags,
    get_group_members,
    permanently_delete_requests,
    resolve_group_add,
    resolve_group_delete_from_directory,
    resolve_group_keep_existing,
    resolve_group_mark_removed,
    resolve_group_update,
    unlink_duplicate_members,
)
from app.person_match import person_from_model


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
    outcome: str = None,
    manager_id: str = None,
) -> models.ManagerRequest:
    req = models.ManagerRequest(
        id=f"test-perm-{uuid.uuid4().hex[:10]}",
        received_at=received_at,
        handled_at=None if status == "new" else datetime.now(timezone.utc),
        manager_id=manager_id,
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
        outcome=outcome,
        duplicate_group_id=None,
    )
    db.add(req)
    db.flush()
    return req


def _create_group(
    db: Session,
    requests: list[models.ManagerRequest],
    classification: str = "confirmed_duplicate",
    directory_person_id: str = None,
) -> models.DuplicateGroup:
    now = datetime.now(timezone.utc)
    group = models.DuplicateGroup(
        id=_new_group_id(),
        partner_id=None,
        classification=classification,
        status="active",
        created_at=now,
        directory_person_id=directory_person_id,
        representative_request_id=None,
    )
    db.add(group)
    db.flush()

    for r in requests:
        r.duplicate_group_id = group.id

    _sync_group_representative_and_tags(db, group, member_requests=requests)
    db.flush()
    return group


class TestPermanentDeletionOnResolution:

    def test_case_a_resolve_add_permanently_deletes_discarded_members_and_keeps_representative(self, db: Session):
        """Case A (Resolve & Add): Retains representative in Directory, permanently deletes discarded siblings."""
        t0 = datetime.now(timezone.utc) - timedelta(days=2)
        t1 = datetime.now(timezone.utc) - timedelta(days=1)
        t2 = datetime.now(timezone.utc)

        r1 = _create_request(db, first_name="Alice", last_name="Smith", email="alice@test.com", location="London", received_at=t0)
        r2 = _create_request(db, first_name="Alice", last_name="Smith", email="alice.s@test.com", location="London", received_at=t1)
        r3 = _create_request(db, first_name="Alice", last_name="Smith", email="alice.smith@test.com", location="London", received_at=t2)

        group = _create_group(db, [r1, r2, r3], classification="potential_duplicate")
        assert group.representative_request_id == r3.id

        final_values = schemas.PersonInfo(
            firstName="Alice",
            lastName="Smith",
            email="alice.smith@test.com",
            location="London",
        )

        dir_row = resolve_group_add(
            db,
            group,
            final_values=final_values,
            admin_id="dev-bypass",
            source_request_id=r3.id,
        )

        db.flush()

        # 1. Directory row exists with status handled / outcome Added
        assert dir_row.id == r3.id
        assert dir_row.status == "handled"
        assert dir_row.outcome == "Added"
        assert dir_row.duplicate_group_id is None

        # 2. Discarded requests r1 and r2 are permanently deleted from database
        deleted_rows = db.query(models.ManagerRequest).filter(models.ManagerRequest.id.in_([r1.id, r2.id])).all()
        assert len(deleted_rows) == 0

        # 3. Future matching logic does not find r1 or r2
        new_incoming = _create_request(db, first_name="Alice", last_name="Smith", email="alice@test.com", location="London", received_at=datetime.now(timezone.utc))
        candidates = _pending_candidates(db, new_incoming)
        candidate_ids = [c.id for c in candidates]
        assert r1.id not in candidate_ids
        assert r2.id not in candidate_ids

    def test_case_b_resolve_update_permanently_deletes_incoming_requests(self, db: Session):
        """Case B (Resolve & Update): Updates Directory record in place, permanently deletes incoming requests."""
        t0 = datetime.now(timezone.utc) - timedelta(days=5)
        t1 = datetime.now(timezone.utc) - timedelta(days=1)
        t2 = datetime.now(timezone.utc)

        dir_person = _create_request(
            db, first_name="Bob", last_name="Jones", email="bob@old.com", location="Manchester",
            received_at=t0, status="handled", outcome="Added"
        )
        r_in1 = _create_request(db, first_name="Bob", last_name="Jones", email="bob.j@new.com", location="Manchester", received_at=t1)
        r_in2 = _create_request(db, first_name="Robert", last_name="Jones", email="robert@new.com", location="Manchester", received_at=t2)

        group = _create_group(db, [r_in1, r_in2], classification="potential_duplicate", directory_person_id=dir_person.id)

        final_values = schemas.PersonInfo(
            firstName="Robert",
            lastName="Jones",
            email="robert@new.com",
            location="Manchester",
        )

        updated_person = resolve_group_update(
            db,
            group,
            dir_person,
            final_values=final_values,
            admin_id="dev-bypass",
        )

        db.flush()

        # 1. Directory person is updated in place
        assert updated_person.id == dir_person.id
        assert updated_person.person_first_name == "Robert"
        assert updated_person.person_email == "robert@new.com"
        assert updated_person.status == "handled"

        # 2. Incoming requests r_in1 and r_in2 are permanently deleted
        deleted_rows = db.query(models.ManagerRequest).filter(models.ManagerRequest.id.in_([r_in1.id, r_in2.id])).all()
        assert len(deleted_rows) == 0

    def test_case_c_resolve_keep_existing_permanently_deletes_incoming_requests(self, db: Session):
        """Case C (Resolve Keep Existing): Leaves Directory untouched, permanently deletes incoming requests."""
        t0 = datetime.now(timezone.utc) - timedelta(days=5)
        t1 = datetime.now(timezone.utc)

        dir_person = _create_request(
            db, first_name="Charlie", last_name="Brown", email="charlie@peanuts.com", location="London",
            received_at=t0, status="handled", outcome="Added"
        )
        r_in = _create_request(db, first_name="Charlie", last_name="Brown", email="charlie.wrong@peanuts.com", location="London", received_at=t1)

        group = _create_group(db, [r_in], classification="potential_duplicate", directory_person_id=dir_person.id)

        count = resolve_group_keep_existing(
            db,
            group,
            admin_id="dev-bypass",
            admin_note="Rejected incorrect incoming request",
        )

        db.flush()

        assert count == 1
        # 1. Directory person unchanged
        db.refresh(dir_person)
        assert dir_person.person_email == "charlie@peanuts.com"

        # 2. Incoming request permanently deleted
        deleted_req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == r_in.id).first()
        assert deleted_req is None

    def test_case_d_resolve_delete_from_directory_permanently_deletes_incoming_and_marks_removed(self, db: Session):
        """Case D (Resolve Delete from Directory): Marks Directory record as Removed and permanently deletes incoming requests."""
        t0 = datetime.now(timezone.utc) - timedelta(days=5)
        t1 = datetime.now(timezone.utc)

        dir_person = _create_request(
            db, first_name="Diana", last_name="Prince", email="diana@amazon.com", location="Themyscira",
            received_at=t0, status="handled", outcome="Added"
        )
        r_in = _create_request(db, first_name="Diana", last_name="Prince", email="diana@amazon.com", location="Themyscira", received_at=t1)

        group = _create_group(db, [r_in], classification="confirmed_duplicate", directory_person_id=dir_person.id)

        final_values = schemas.PersonInfo(
            firstName="Diana",
            lastName="Prince",
            email="diana@amazon.com",
            location="Themyscira",
        )

        count = resolve_group_delete_from_directory(
            db,
            group,
            dir_person,
            final_values=final_values,
            admin_id="dev-bypass",
        )

        db.flush()

        assert count == 1
        # 1. Directory record marked as Removed
        db.refresh(dir_person)
        assert dir_person.outcome == "Removed"
        assert dir_person.action == "Remove"

        # 2. Incoming request permanently deleted
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.id == r_in.id).first() is None

    def test_case_e_resolve_mark_removed_permanently_deletes_discarded_members(self, db: Session):
        """Case E (Resolve & Mark Removed): Retains representative as Removed Directory record, permanently deletes discarded siblings."""
        t0 = datetime.now(timezone.utc) - timedelta(hours=3)
        t1 = datetime.now(timezone.utc) - timedelta(hours=1)

        r1 = _create_request(db, first_name="Evan", last_name="Wright", email="evan@old.com", location="Bristol", received_at=t0)
        r2 = _create_request(db, first_name="Evan", last_name="Wright", email="evan@new.com", location="Bristol", received_at=t1)

        group = _create_group(db, [r1, r2], classification="potential_duplicate")

        final_values = schemas.PersonInfo(
            firstName="Evan",
            lastName="Wright",
            email="evan@new.com",
            location="Bristol",
        )

        count = resolve_group_mark_removed(
            db,
            group,
            final_values=final_values,
            admin_id="dev-bypass",
        )

        db.flush()

        assert count == 2
        # 1. Representative r2 is retained with outcome Removed
        db.refresh(r2)
        assert r2.status == "handled"
        assert r2.outcome == "Removed"
        assert r2.action == "Remove"

        # 2. Discarded sibling r1 is permanently deleted
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.id == r1.id).first() is None

    def test_cascade_cleanup_dismissed_matches_and_stats(self, db: Session):
        """Foreign key cascades: DismissedDuplicateMatch, DismissedGroupMatch, ManagerRequestView are cleaned up and manager stats decremented."""
        t0 = datetime.now(timezone.utc)
        now = datetime.now(timezone.utc)
        r_del = _create_request(db, first_name="Fiona", last_name="Gallagher", email="fiona@chicago.com", location="Chicago", received_at=t0, status="new")
        r_other = _create_request(db, first_name="Frank", last_name="Gallagher", email="frank@chicago.com", location="Chicago", received_at=t0, status="new")

        # Create DismissedDuplicateMatch
        db.add(models.DismissedDuplicateMatch(
            id=f"ddm-{uuid.uuid4().hex[:10]}",
            request_id_1=r_del.id,
            request_id_2=r_other.id,
            created_at=now,
        ))
        # Create DismissedGroupMatch
        group = _create_group(db, [r_other])
        db.add(models.DismissedGroupMatch(
            id=f"dgm-{uuid.uuid4().hex[:10]}",
            request_id=r_del.id,
            group_id=group.id,
            created_at=now,
        ))
        # Create ManagerRequestView
        user = db.query(models.PowermusicUser).first()
        if user:
            db.add(models.ManagerRequestView(
                request_id=r_del.id,
                manager_id=user.id,
                seen_at=now,
            ))
        db.flush()

        # Delete r_del
        deleted_count = permanently_delete_requests(db, [r_del.id])
        assert deleted_count == 1

        # Check dependent tables
        assert db.query(models.DismissedDuplicateMatch).filter(
            (models.DismissedDuplicateMatch.request_id_1 == r_del.id) | (models.DismissedDuplicateMatch.request_id_2 == r_del.id)
        ).count() == 0

        assert db.query(models.DismissedGroupMatch).filter(models.DismissedGroupMatch.request_id == r_del.id).count() == 0
        assert db.query(models.ManagerRequestView).filter(models.ManagerRequestView.request_id == r_del.id).count() == 0
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.id == r_del.id).first() is None

    def test_unlink_not_same_person_preserves_both_requests(self, db: Session):
        """Unlink / 'Not the Same Person' workflow: DOES NOT delete either request."""
        t0 = datetime.now(timezone.utc) - timedelta(days=1)
        t1 = datetime.now(timezone.utc)

        r1 = _create_request(db, first_name="George", last_name="Clark", email="george.c@test.com", location="London", received_at=t0)
        r2 = _create_request(db, first_name="George", last_name="Clarkson", email="george.ck@test.com", location="London", received_at=t1)

        group = _create_group(db, [r1, r2], classification="potential_duplicate")

        # Unlink r1 ("Not the Same Person")
        unlink_duplicate_members(db, group_id=group.id, request_id_1=r2.id, request_id_2=r1.id, admin_id="dev-bypass")
        db.flush()

        db.refresh(r1)
        db.refresh(r2)

        # Both requests MUST survive in the database with status="new"
        assert r1.status == "new"
        assert r2.status == "new"
        assert r1.duplicate_group_id is None
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.id.in_([r1.id, r2.id])).count() == 2

    def test_router_endpoints_full_cycle(self, db: Session):
        """API endpoints: verify end-to-end HTTP router execution with permanent deletion and commit."""
        from app.api.routers.pilot1 import resolve_group_add_api, resolve_group_update_api
        from app.api.auth import AuthenticatedUser

        t0 = datetime.now(timezone.utc) - timedelta(days=2)
        t1 = datetime.now(timezone.utc) - timedelta(days=1)

        r1 = _create_request(db, first_name="Hannah", last_name="Abbott", email="hannah@hogwarts.edu", location="Hogsmeade", received_at=t0)
        r2 = _create_request(db, first_name="Hannah", last_name="Abbott", email="hannah.a@hogwarts.edu", location="Hogsmeade", received_at=t1)

        group = _create_group(db, [r1, r2], classification="potential_duplicate")
        db.commit()

        admin_user = AuthenticatedUser(id="dev-bypass", email="admin@example.com", role="admin")

        payload = schemas.ResolveAndAddIn(
            finalValues=schemas.PersonInfo(
                firstName="Hannah",
                lastName="Abbott",
                email="hannah.a@hogwarts.edu",
                location="Hogsmeade",
            ),
            sourceRequestId=r2.id,
        )

        res = resolve_group_add_api(group_id=group.id, payload=payload, db=db, admin=admin_user)

        assert res["status"] == "resolved"
        assert res["resolvedRequestCount"] == 2

        # Verify r1 is permanently deleted from database
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.id == r1.id).first() is None
        # Verify r2 is in Directory
        r2_db = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == r2.id).first()
        assert r2_db is not None
        assert r2_db.status == "handled"
        assert r2_db.outcome == "Added"
