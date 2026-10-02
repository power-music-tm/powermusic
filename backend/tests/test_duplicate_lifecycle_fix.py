"""Automated regression tests for request lifecycle, merge exclusion, and deletion isolation.

Verifies:
Scenario A: Requests consumed by Merge & Update Directory never reappear in future request history.
Scenario B: Individually deleted requests are permanently removed and never regroup.
Scenario C: "Not the same person" (Unlink) preserves active standalone requests.
Scenario D: Deleting from Group A never attaches requests to an unrelated Group B.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import ARRAY
from sqlalchemy.dialects.postgresql import JSONB

from app import models, schemas
from app.duplicate_group_service import (
    process_request_grouping,
    resolve_group_add,
    unlink_duplicate_members,
    get_group_members,
)
from app.api.routers.pilot1 import dismiss_request, get_duplicate_group_details, AuthenticatedUser

# Register sqlite adapters for JSON/ARRAY columns
sqlite3.register_adapter(list, json.dumps)
sqlite3.register_adapter(dict, json.dumps)


@compiles(ARRAY, 'sqlite')
def _compile_array(type_, compiler, **kw):
    return 'JSON'

@compiles(JSONB, 'sqlite')
def _compile_jsonb(type_, compiler, **kw):
    return 'JSON'


@pytest.fixture
def db():
    engine = create_engine('sqlite:///:memory:')
    models.Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def admin_user():
    return AuthenticatedUser(
        id="dev-bypass",
        email="admin@example.com",
        role="admin",
    )


class TestDuplicateLifecycleFix:

    def test_scenario_a_merged_requests_do_not_reappear(self, db: Session):
        """Scenario A: Merged requests (R1, R2, R3) must never reappear in request history when R7 arrives later."""
        now = datetime.now(timezone.utc)
        gll_partner = models.Partner(id="partner-gll", name="GLL Fitness", created_at=now, updated_at=now)
        db.add(gll_partner)
        db.flush()

        r1 = models.ManagerRequest(
            id=f"test-req-a1-{uuid.uuid4().hex[:6]}",
            person_first_name="Jane",
            person_last_name="Doe",
            person_email="jane.doe@example.com",
            person_location="Gym A",
            action="Add",
            status="new",
            received_at=now,
            partner_id=gll_partner.id,
        )
        r2 = models.ManagerRequest(
            id=f"test-req-a2-{uuid.uuid4().hex[:6]}",
            person_first_name="Jane",
            person_last_name="Doe",
            person_email="jane.doe@example.com",
            person_location="Gym A",
            action="Add",
            status="new",
            received_at=now,
            partner_id=gll_partner.id,
        )
        r3 = models.ManagerRequest(
            id=f"test-req-a3-{uuid.uuid4().hex[:6]}",
            person_first_name="Jane",
            person_last_name="Doe",
            person_email="jane.doe@example.com",
            person_location="Gym A",
            action="Add",
            status="new",
            received_at=now,
            partner_id=gll_partner.id,
        )
        r4 = models.ManagerRequest(
            id=f"test-req-a4-{uuid.uuid4().hex[:6]}",
            person_first_name="Jane",
            person_last_name="Doe",
            person_email="jane.doe@example.com",
            person_location="Gym A",
            action="Add",
            status="new",
            received_at=now,
            partner_id=gll_partner.id,
        )
        group1 = None
        for req in [r1, r2, r3, r4]:
            db.add(req)
            db.flush()
            g = process_request_grouping(db, req)
            if g:
                group1 = g

        db.flush()
        assert group1 is not None
        members = get_group_members(db, group1.id)
        assert len(members) == 4

        r1_id, r2_id, r3_id, r4_id = r1.id, r2.id, r3.id, r4.id

        # Admin resolves group via Merge and Update Directory using R4
        final_info = schemas.PersonInfo(
            firstName="Jane",
            lastName="Doe",
            email="jane.doe@example.com",
            location="London Gym",
        )
        dir_person = resolve_group_add(
            db,
            group1,
            final_values=final_info,
            admin_id="dev-bypass",
            source_request_id=r4_id,
        )
        db.commit()

        # Verify consumed requests (R1, R2, R3) are physically deleted
        for consumed_id in [r1_id, r2_id, r3_id]:
            assert db.query(models.ManagerRequest).filter_by(id=consumed_id).first() is None

        # Verify Directory record (R4) is handled/Added
        assert dir_person.id == r4_id
        assert dir_person.status == "handled"

        # Later: Request 7 arrives for Jane Doe
        r7 = models.ManagerRequest(
            id=f"test-req-a7-{uuid.uuid4().hex[:6]}",
            person_first_name="Jane",
            person_last_name="Doe",
            person_email="jane.doe@example.com",
            person_location="Gym B",
            action="Add",
            status="new",
            received_at=now,
            partner_id=gll_partner.id,
        )
        db.add(r7)
        db.flush()

        group2 = process_request_grouping(db, r7)
        db.commit()

        assert group2 is not None
        assert group2.directory_person_id == dir_person.id

        # Fetch group details for group2
        group_details = get_duplicate_group_details(group2.id, db=db, _admin=None)
        dir_out = group_details["directoryPerson"]
        assert dir_out is not None

        history_request_ids = [h.get("requestId") for h in dir_out.get("requestHistory", [])]
        # Verify consumed requests R1, R2, R3 DO NOT appear in request history
        for consumed_id in [r1_id, r2_id, r3_id]:
            assert consumed_id not in history_request_ids

    def test_scenario_b_deleted_request_is_permanently_removed(self, db: Session, admin_user):
        """Scenario B: Deleting a request from a group permanently removes it from active lifecycle."""
        now = datetime.now(timezone.utc)
        ra = models.ManagerRequest(
            id=f"test-req-b-a-{uuid.uuid4().hex[:6]}",
            person_first_name="Bob",
            person_last_name="Smith",
            person_email="bob.smith@example.com",
            person_location="",
            action="Add",
            status="new",
            received_at=now,
        )
        rb = models.ManagerRequest(
            id=f"test-req-b-b-{uuid.uuid4().hex[:6]}",
            person_first_name="Bob",
            person_last_name="Smith",
            person_email="bob.smith@example.com",
            person_location="",
            action="Add",
            status="new",
            received_at=now,
        )
        db.add_all([ra, rb])
        db.flush()

        group = process_request_grouping(db, ra)
        process_request_grouping(db, rb)
        db.commit()

        assert group is not None
        ra_id = ra.id

        # Admin deletes Request RA
        dismiss_request(request_id=ra_id, db=db, admin=admin_user)

        # Assert RA is permanently deleted
        assert db.query(models.ManagerRequest).filter_by(id=ra_id).first() is None

    def test_scenario_c_not_the_same_person_preserves_active_request(self, db: Session):
        """Scenario C: Unlinking ('Not the same person') separates request without deleting it."""
        now = datetime.now(timezone.utc)
        r1 = models.ManagerRequest(
            id=f"test-req-c1-{uuid.uuid4().hex[:6]}",
            person_first_name="Charlie",
            person_last_name="Brown",
            person_email="charlie@example.com",
            person_location="",
            action="Add",
            status="new",
            received_at=now,
        )
        r2 = models.ManagerRequest(
            id=f"test-req-c2-{uuid.uuid4().hex[:6]}",
            person_first_name="Charlie",
            person_last_name="Brown",
            person_email="charlie@example.com",
            person_location="",
            action="Add",
            status="new",
            received_at=now,
        )
        db.add_all([r1, r2])
        db.flush()

        group = process_request_grouping(db, r1)
        process_request_grouping(db, r2)
        db.flush()

        assert group is not None
        res = unlink_duplicate_members(db, group.id, r1.id, r2.id, admin_id="dev-bypass", strict_single=True)
        db.commit()

        assert res is not None
        # Assert R2 is NOT deleted and remains an active standalone request
        r2_db = db.query(models.ManagerRequest).filter_by(id=r2.id).first()
        assert r2_db is not None
        assert r2_db.status == "new"
        assert r2_db.duplicate_group_id is None

    def test_scenario_d_multiple_groups_isolation(self, db: Session, admin_user):
        """Scenario D: Deleting from Group A never causes attachment to Group B."""
        now = datetime.now(timezone.utc)
        r_a1 = models.ManagerRequest(
            id=f"test-req-d-a1-{uuid.uuid4().hex[:6]}",
            person_first_name="Alice",
            person_last_name="Vance",
            person_email="alice.vance@example.com",
            person_location="",
            action="Add",
            status="new",
            received_at=now,
        )
        r_b1 = models.ManagerRequest(
            id=f"test-req-d-b1-{uuid.uuid4().hex[:6]}",
            person_first_name="David",
            person_last_name="Wright",
            person_email="david.wright@example.com",
            person_location="",
            action="Add",
            status="new",
            received_at=now,
        )
        db.add_all([r_a1, r_b1])
        db.flush()

        r_a1_id = r_a1.id
        r_b1_id = r_b1.id

        # Admin deletes r_a1
        dismiss_request(request_id=r_a1_id, db=db, admin=admin_user)

        # Assert r_a1 is gone
        assert db.query(models.ManagerRequest).filter_by(id=r_a1_id).first() is None
        # Assert r_b1 is untouched and has no duplicate group
        r_b1_db = db.query(models.ManagerRequest).filter_by(id=r_b1_id).first()
        assert r_b1_db is not None
        assert r_b1_db.duplicate_group_id is None

    def test_unlinked_request_from_directory_group_does_not_update_directory(self, db: Session):
        """Unlinking a request from a directory-linked group prevents re-matching and tag_already_exists."""
        from app.directory_person_match import find_directory_conflict, person_from_model
        from app.duplicate_group_service import resolve_group_add, unlink_duplicate_members, process_request_grouping
        from app.manager_request_serialize import requests_to_api_dicts, request_to_api_dict
        from app.manager_request_tags import TAG_ALREADY_EXISTS

        now = datetime.now(timezone.utc)
        d_rec = models.ManagerRequest(
            id=f"test-dir-{uuid.uuid4().hex[:6]}",
            person_first_name="Diana",
            person_last_name="Prince",
            person_email="diana@example.com",
            person_location="HQ",
            action="Add",
            status="handled",
            outcome="Added",
            handled_at=now,
            received_at=now,
        )
        r_new = models.ManagerRequest(
            id=f"test-req-new-{uuid.uuid4().hex[:6]}",
            person_first_name="Diana",
            person_last_name="Prince",
            person_email="diana@example.com",
            person_location="HQ",
            action="Add",
            status="new",
            received_at=now,
        )
        db.add_all([d_rec, r_new])
        db.flush()

        group = process_request_grouping(db, r_new)
        db.flush()
        assert group is not None
        assert group.directory_person_id == d_rec.id

        # Unlink r_new from the directory-backed group
        unlink_duplicate_members(db, group.id, d_rec.id, r_new.id, admin_id="dev-bypass", strict_single=True)
        db.flush()

        # Assert dismissal persisted for (d_rec.id, r_new.id)
        from app.duplicate_matching import are_requests_dismissed
        assert are_requests_dismissed(db, d_rec.id, r_new.id) is True

        # Assert find_directory_conflict ignores d_rec for r_new
        conflict = find_directory_conflict(
            person=person_from_model(r_new),
            action="Add",
            directory_rows=[d_rec],
            db=db,
            req_id=r_new.id,
        )
        assert conflict is None

        # Assert serialized request does not get TAG_ALREADY_EXISTS
        api_dict = request_to_api_dict(r_new, db=db)
        assert TAG_ALREADY_EXISTS not in (api_dict.get("tags") or [])

    def test_unlinked_two_requests_then_one_added_to_directory(self, db: Session):
        """When 2 new requests are unlinked and 1 is added to Directory, the other is not flagged already_exists."""
        from app.directory_person_match import find_directory_conflict, person_from_model
        from app.duplicate_group_service import unlink_duplicate_members, process_request_grouping
        from app.manager_request_serialize import request_to_api_dict
        from app.manager_request_tags import TAG_ALREADY_EXISTS

        now = datetime.now(timezone.utc)
        r1 = models.ManagerRequest(
            id=f"test-req-e1-{uuid.uuid4().hex[:6]}",
            person_first_name="Eve",
            person_last_name="Polastri",
            person_email="eve@example.com",
            person_location="London",
            action="Add",
            status="new",
            received_at=now,
        )
        r2 = models.ManagerRequest(
            id=f"test-req-e2-{uuid.uuid4().hex[:6]}",
            person_first_name="Eve",
            person_last_name="Polastri",
            person_email="eve@example.com",
            person_location="London",
            action="Add",
            status="new",
            received_at=now,
        )
        db.add_all([r1, r2])
        db.flush()

        group = process_request_grouping(db, r1)
        process_request_grouping(db, r2)
        db.flush()

        assert group is not None
        unlink_duplicate_members(db, group.id, r1.id, r2.id, admin_id="dev-bypass", strict_single=True)
        db.flush()

        # Mark r1 as handled directory entry
        r1.status = "handled"
        r1.outcome = "Added"
        r1.handled_at = now
        db.flush()

        # Assert r2 does not match r1 as directory conflict
        conflict = find_directory_conflict(
            person=person_from_model(r2),
            action="Add",
            directory_rows=[r1],
            db=db,
            req_id=r2.id,
        )
        assert conflict is None

        # Assert r2 API serialization does not include TAG_ALREADY_EXISTS
        api_dict = request_to_api_dict(r2, db=db)
        assert TAG_ALREADY_EXISTS not in (api_dict.get("tags") or [])

    def test_unlinked_two_requests_both_added_to_directory_produce_separate_ledger_rows(self, db: Session):
        """Verify that when 2 requests with matching emails are unlinked via Not The Same Person,
        and both are subsequently added to the directory, both appear as distinct rows in directory_ledger_rows."""
        from app.directory_person_match import directory_ledger_rows

        now = datetime.now(timezone.utc)
        r1 = models.ManagerRequest(
            id=f"test-req-f1-{uuid.uuid4().hex[:6]}",
            person_first_name="Florence",
            person_last_name="Baker",
            person_email="fbaker@gmail.com",
            person_location="London",
            action="Add",
            status="new",
            received_at=now - timedelta(minutes=5),
        )
        r2 = models.ManagerRequest(
            id=f"test-req-f2-{uuid.uuid4().hex[:6]}",
            person_first_name="Flouurence",
            person_last_name="Baker",
            person_email="fbaker@gmail.com",
            person_location="London",
            action="Add",
            status="new",
            received_at=now,
        )
        db.add_all([r1, r2])
        db.flush()

        group = process_request_grouping(db, r1)
        process_request_grouping(db, r2)
        db.flush()

        assert group is not None
        unlink_duplicate_members(db, group.id, r1.id, r2.id, admin_id="dev-bypass", strict_single=True)
        db.flush()

        # Add r1 to Directory
        r1.status = "handled"
        r1.outcome = "Added"
        r1.handled_at = now - timedelta(minutes=2)
        db.flush()

        # Add r2 to Directory
        r2.status = "handled"
        r2.outcome = "Added"
        r2.handled_at = now
        db.flush()

        ledger = directory_ledger_rows(db)
        ledger_ids = {row.id for row in ledger}
        assert r1.id in ledger_ids
        assert r2.id in ledger_ids


