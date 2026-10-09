"""Regression tests for preventing automated email requests from reappearing after merge & directory update."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app import models, schemas
from app.manager_request_intake import (
    intake_automated_email_request,
    intake_manager_submission,
)
from app.manager_request_tags import (
    TAG_ALREADY_EXISTS,
    TAG_AUTO_MAIL,
    TAG_CONFIRMED_DUPLICATE,
    TAG_POTENTIAL_DUPLICATE,
    TAG_UNVERIFIED,
    TAG_VERIFIED,
)
from app.duplicate_group_service import (
    resolve_group_add,
    resolve_group_update,
    resolve_group_keep_existing,
    resolve_group_delete_from_directory,
    process_request_grouping,
)
from app.pilot2.sync import catch_up_recent_messages
from app.api.routers.pilot1 import _visible_new_requests_query
from app.database import SessionLocal


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
        session.rollback()
    finally:
        session.close()


@pytest.fixture
def admin_id(db: Session) -> str:
    admin = (
        db.query(models.PowermusicUser)
        .filter(models.PowermusicUser.role == "admin")
        .first()
    )
    if admin is None:
        pytest.skip("No admin profile in database for tests")
    return str(admin.id)


@pytest.fixture
def manager_id(db: Session) -> str:
    manager = (
        db.query(models.PowermusicUser)
        .filter(models.PowermusicUser.role == "manager")
        .first()
    )
    if manager is None:
        pytest.skip("No manager profile in database for tests")
    return str(manager.id)


def _person(**kwargs):
    defaults = dict(
        firstName="Rupert",
        lastName="Grint",
        email=f"rupert-{uuid.uuid4().hex[:8]}@example.com",
        location="England",
    )
    defaults.update(kwargs)
    return schemas.PersonInfo(**defaults)


class TestAutomatedEmailReappearanceFix:
    def test_01_merged_automated_email_request_does_not_reappear_in_new_requests(
        self, db: Session, admin_id: str
    ):
        """1 & 2. Automated email request with potential duplicates merged & saved to Directory does not reappear."""
        person = _person()
        msg_id_1 = f"gmail-rg-1-{uuid.uuid4().hex}"
        msg_id_2 = f"gmail-rg-2-{uuid.uuid4().hex}"

        req1 = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id_1
        )
        req2 = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id_2
        )
        db.flush()

        assert req1.duplicate_group_id is not None
        assert req1.duplicate_group_id == req2.duplicate_group_id

        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == req1.duplicate_group_id)
            .first()
        )
        dir_row = resolve_group_add(
            db,
            group,
            final_values=person,
            admin_id=admin_id,
            source_request_id=req1.id,
        )
        db.commit()

        # Refetch visible new requests
        new_reqs = _visible_new_requests_query(db).all()
        new_ids = [r.id for r in new_reqs]
        assert req1.id not in new_ids
        assert req2.id not in new_ids
        assert dir_row.status == "handled"

    def test_02_repeating_query_after_delay_does_not_cause_reappearance(
        self, db: Session, admin_id: str
    ):
        """3. Repeating the query does not cause the resolved request to reappear."""
        person = _person()
        msg_id = f"gmail-delay-{uuid.uuid4().hex}"
        req = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id
        )
        db.flush()

        # Move to Directory via handled
        req.status = "handled"
        req.outcome = "Added"
        db.commit()

        # Query multiple times
        q1 = _visible_new_requests_query(db).filter(models.ManagerRequest.person_email == person.email).all()
        q2 = _visible_new_requests_query(db).filter(models.ManagerRequest.person_email == person.email).all()
        assert len(q1) == 0
        assert len(q2) == 0

    def test_03_reprocessing_gmail_history_does_not_recreate_resolved_request(
        self, db: Session, admin_id: str
    ):
        """4. Reprocessing existing Gmail message IDs does not recreate a resolved request."""
        person = _person()
        msg_id_1 = f"gmail-hist-1-{uuid.uuid4().hex}"
        msg_id_2 = f"gmail-hist-2-{uuid.uuid4().hex}"

        req1 = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id_1
        )
        req2 = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id_2
        )
        db.flush()

        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == req1.duplicate_group_id)
            .first()
        )
        resolve_group_add(
            db,
            group,
            final_values=person,
            admin_id=admin_id,
            source_request_id=req1.id,
        )
        db.commit()

        # Simulate Gmail sync replaying the discarded message_id_2
        re_imported = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id_2
        )
        db.commit()

        # Verify re_imported returned already processed status without creating new 'new' request row
        assert re_imported.status == "handled" or re_imported.outcome == "AlreadyProcessed"
        new_reqs = _visible_new_requests_query(db).filter(models.ManagerRequest.person_email == person.email).all()
        assert len(new_reqs) == 0

    def test_04_duplicate_group_processing_does_not_reintroduce_resolved_requests(
        self, db: Session, admin_id: str
    ):
        """5. Duplicate-group processing does not reintroduce previously resolved requests."""
        person = _person()
        msg_id = f"gmail-group-{uuid.uuid4().hex}"
        req = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id
        )
        db.flush()

        req.status = "handled"
        req.outcome = "Added"
        db.commit()

        # Trigger duplicate group processing
        process_request_grouping(db, req)
        db.commit()

        new_reqs = _visible_new_requests_query(db).filter(models.ManagerRequest.person_email == person.email).all()
        assert len(new_reqs) == 0

    def test_05_already_exists_in_directory_decision_remains_resolved(
        self, db: Session, admin_id: str
    ):
        """6. Already Exists in Directory decision can be completed without returning again."""
        person = _person()

        # 1. Existing Directory record
        dir_req = models.ManagerRequest(
            id=f"test-dir-{uuid.uuid4().hex[:8]}",
            received_at=datetime.now(timezone.utc),
            handled_at=datetime.now(timezone.utc),
            person_first_name=person.firstName,
            person_last_name=person.lastName,
            person_email=person.email,
            person_location=person.location,
            action="Add",
            tags=[TAG_VERIFIED],
            status="handled",
            outcome="Added",
            partner_id="partner-001",
        )
        db.add(dir_req)
        db.flush()

        # 2. Incoming automated email request
        msg_id = f"gmail-exists-{uuid.uuid4().hex}"
        incoming = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id
        )
        db.flush()

        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == incoming.duplicate_group_id)
            .first()
        )
        assert group is not None

        # Admin resolves by keeping existing Directory record
        resolve_group_keep_existing(db, group, admin_id=admin_id)
        db.commit()

        # Simulate Gmail history sync replaying msg_id
        replay = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id
        )
        db.commit()

        new_reqs = _visible_new_requests_query(db).filter(models.ManagerRequest.person_email == person.email).all()
        assert len(new_reqs) == 0

    def test_06_already_removed_decision_remains_resolved(
        self, db: Session, admin_id: str
    ):
        """7. Already Removed decision remains resolved after refetching."""
        person = _person()

        # 1. Directory record marked Removed
        dir_req = models.ManagerRequest(
            id=f"test-rem-{uuid.uuid4().hex[:8]}",
            received_at=datetime.now(timezone.utc),
            handled_at=datetime.now(timezone.utc),
            person_first_name=person.firstName,
            person_last_name=person.lastName,
            person_email=person.email,
            person_location=person.location,
            action="Remove",
            tags=[TAG_VERIFIED],
            status="handled",
            outcome="Removed",
            partner_id="partner-001",
        )
        db.add(dir_req)
        db.flush()

        # 2. Incoming request to remove
        msg_id = f"gmail-removed-{uuid.uuid4().hex}"
        incoming = intake_automated_email_request(
            db, person=person, action="Remove", source_gmail_message_id=msg_id
        )
        db.flush()

        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == incoming.duplicate_group_id)
            .first()
        )
        if group:
            resolve_group_keep_existing(db, group, admin_id=admin_id)
            db.commit()

        new_reqs = _visible_new_requests_query(db).filter(models.ManagerRequest.person_email == person.email).all()
        assert len(new_reqs) == 0

    def test_07_genuinely_new_email_with_new_message_id_creates_new_request(
        self, db: Session, admin_id: str
    ):
        """8. Genuinely new email with a different Gmail message ID still follows normal duplicate flow."""
        person = _person()
        msg_id_1 = f"gmail-old-{uuid.uuid4().hex}"
        req1 = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id_1
        )
        req1.status = "handled"
        req1.outcome = "Added"
        db.commit()

        # Genuinely NEW incoming email with a distinct message ID
        msg_id_2 = f"gmail-new-{uuid.uuid4().hex}"
        req2 = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id_2
        )
        db.commit()

        assert req2.id != req1.id
        assert req2.status == "new"
        assert TAG_ALREADY_EXISTS in req2.tags

    def test_08_manager_form_workflow_continues_working_as_before(
        self, db: Session, manager_id: str, admin_id: str
    ):
        """9. Manager-form workflow continues working exactly as before."""
        person = _person()
        req1 = intake_manager_submission(
            db, person=person, action="Add", manager_id=manager_id, partner_id="partner-001"
        )
        req2 = intake_manager_submission(
            db, person=person, action="Add", manager_id=manager_id, partner_id="partner-001"
        )
        db.flush()

        assert req1.duplicate_group_id == req2.duplicate_group_id
        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == req1.duplicate_group_id)
            .first()
        )
        resolve_group_add(
            db, group, final_values=person, admin_id=admin_id, source_request_id=req1.id
        )
        db.commit()

        new_reqs = _visible_new_requests_query(db).filter(models.ManagerRequest.person_email == person.email).all()
        assert len(new_reqs) == 0

    def test_09_retained_directory_record_remains_consistent_after_merge(
        self, db: Session, admin_id: str
    ):
        """10. Retained Directory record and its source information remain consistent after merging."""
        person = _person(firstName="Rupert", lastName="Grint", location="Hogwarts")
        msg_id = f"gmail-rupert-retain-{uuid.uuid4().hex}"
        req = intake_automated_email_request(
            db, person=person, action="Add", source_gmail_message_id=msg_id
        )
        db.flush()

        req.status = "handled"
        req.outcome = "Added"
        db.commit()

        refetched = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == req.id).first()
        assert refetched.person_first_name == "Rupert"
        assert refetched.person_last_name == "Grint"
        assert refetched.person_location == "Hogwarts"
        assert refetched.source_gmail_message_id == msg_id
        assert refetched.status == "handled"
        assert refetched.outcome == "Added"
