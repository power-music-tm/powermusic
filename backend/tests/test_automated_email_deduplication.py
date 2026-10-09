"""Comprehensive regression tests for automated email request deduplication.

Verifies:
1. Processing a Gmail message once creates one request.
2. Processing the same Gmail message again creates no additional request.
3. Replaying the same Gmail history event creates no additional request.
4. A new incoming message does not cause existing messages to generate duplicate requests.
5. Backfill and ongoing synchronization cannot create duplicate requests for the same source message.
6. Concurrent executions attempting to create the same request result in only one database row.
7. Database uniqueness conflict is handled gracefully as an expected duplicate outcome.
8. Two different Gmail message IDs create their own legitimate requests (even for same person/thread).
9. Manager-form requests continue to work and permit multiple submissions without source Gmail constraint conflicts.
10. Existing duplicate-grouping behavior functions alongside request-level uniqueness.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import ARRAY, TypeDecorator, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.sqlite.base import SQLiteDialect

from app import models, schemas
from app.partner_allowlists import create_partner, create_automated_source
from app.automated_person_intake import intake_roster_message
from app.manager_request_intake import intake_automated_email_request, intake_manager_submission, create_manager_request
from app.manager_request_tags import TAG_AUTO_MAIL, TAG_PARTNER_REQUEST

# Register sqlite adapters for JSON/ARRAY columns
sqlite3.register_adapter(list, json.dumps)
sqlite3.register_adapter(dict, json.dumps)


@compiles(ARRAY, 'sqlite')
def _compile_array(type_, compiler, **kw):
    return 'JSON'

@compiles(JSONB, 'sqlite')
def _compile_jsonb(type_, compiler, **kw):
    return 'JSON'


_orig_type_descriptor = SQLiteDialect.type_descriptor
def _sqlite_type_descriptor(self, type_):
    if isinstance(type_, ARRAY):
        class _SQLiteArray(TypeDecorator):
            impl = JSON
            cache_ok = True
            def process_result_value(self, value, dialect):
                if isinstance(value, str):
                    try:
                        return json.loads(value)
                    except Exception:
                        return [value]
                return value
        return _SQLiteArray()
    return _orig_type_descriptor(self, type_)
SQLiteDialect.type_descriptor = _sqlite_type_descriptor


@pytest.fixture
def db():
    engine = create_engine('sqlite:///:memory:')
    models.Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_requests_source_gmail_message_id "
            "ON manager_requests (source_gmail_message_id) "
            "WHERE source_gmail_message_id IS NOT NULL AND source_gmail_message_id != '';"
        ))
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def test_setup(db: Session):
    partner = create_partner(db, "PureGym Test Partner")
    create_automated_source(db, "roster@puregym.com", partner.id)
    db.commit()

    manager_user = models.PowermusicUser(
        id=uuid.uuid4(),
        email="manager@puregym.com",
        first_name="Jane",
        last_name="Doe",
        club="London",
        role="manager",
    )
    admin_user = models.PowermusicUser(
        id=uuid.uuid4(),
        email="admin@powermusic.com",
        first_name="Admin",
        last_name="User",
        role="admin",
    )
    db.add_all([manager_user, admin_user])
    db.commit()

    return partner, manager_user, admin_user


class TestAutomatedEmailDeduplication:
    def test_1_process_gmail_message_once_creates_one_request(self, db: Session, test_setup):
        partner, _, _ = test_setup
        person = schemas.PersonInfo(firstName="John", lastName="Smith", email="jsmith@example.com", location="London")
        
        req = intake_automated_email_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="msg-001",
            from_email="roster@puregym.com",
            partner_id=partner.id,
        )
        db.commit()

        assert req is not None
        assert req.source_gmail_message_id == "msg-001"
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.source_gmail_message_id == "msg-001").count() == 1

    def test_2_process_same_gmail_message_again_creates_no_additional_request(self, db: Session, test_setup):
        partner, _, _ = test_setup
        person = schemas.PersonInfo(firstName="John", lastName="Smith", email="jsmith@example.com", location="London")

        req1 = intake_automated_email_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="msg-002",
            from_email="roster@puregym.com",
            partner_id=partner.id,
        )
        db.commit()

        # Re-process same message ID
        req2 = intake_automated_email_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="msg-002",
            from_email="roster@puregym.com",
            partner_id=partner.id,
        )
        db.commit()

        assert req1.id == req2.id
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.source_gmail_message_id == "msg-002").count() == 1

    def test_3_replaying_same_gmail_history_event_creates_no_additional_request(self, db: Session, test_setup):
        partner, _, _ = test_setup
        body = "Name: Alice Walker\nEmail: alice@example.com\nClub: Manchester"
        
        # 1st push/history import
        res1 = intake_roster_message(
            db,
            from_email="roster@puregym.com",
            from_name="PureGym Automated Intake",
            subject="PureGym Joinee",
            body=body,
            gmail_message_id="history-msg-003",
        )
        db.commit()
        assert res1 is True

        # 2nd push/history replay of same message ID
        res2 = intake_roster_message(
            db,
            from_email="roster@puregym.com",
            from_name="PureGym Automated Intake",
            subject="PureGym Joinee",
            body=body,
            gmail_message_id="history-msg-003",
        )
        db.commit()
        assert res2 is True

        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.source_gmail_message_id == "history-msg-003").count() == 1

    def test_4_new_incoming_message_does_not_dupe_existing_messages(self, db: Session, test_setup):
        partner, _, _ = test_setup

        # Message 1
        intake_roster_message(
            db,
            from_email="roster@puregym.com",
            from_name="Intake",
            subject="PureGym Joinee",
            body="Name: User One\nEmail: u1@example.com\nClub: Leeds",
            gmail_message_id="msg-101",
        )
        db.commit()

        # Message 2 (different person, different msg ID)
        intake_roster_message(
            db,
            from_email="roster@puregym.com",
            from_name="Intake",
            subject="PureGym Joinee",
            body="Name: User Two\nEmail: u2@example.com\nClub: Leeds",
            gmail_message_id="msg-102",
        )
        db.commit()

        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.source_gmail_message_id == "msg-101").count() == 1
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.source_gmail_message_id == "msg-102").count() == 1

    def test_5_backfill_and_sync_cannot_dupe_same_source_message(self, db: Session, test_setup):
        partner, _, _ = test_setup

        # Polling/Push sync
        intake_automated_email_request(
            db,
            person=schemas.PersonInfo(firstName="Bob", lastName="Jones", email="bjones@example.com", location="Bristol"),
            action="Add",
            source_gmail_message_id="sync-backfill-msg",
            from_email="roster@puregym.com",
            partner_id=partner.id,
        )
        db.commit()

        # Backfill runs later over same message ID
        intake_automated_email_request(
            db,
            person=schemas.PersonInfo(firstName="Bob", lastName="Jones", email="bjones@example.com", location="Bristol"),
            action="Add",
            source_gmail_message_id="sync-backfill-msg",
            from_email="roster@puregym.com",
            partner_id=partner.id,
        )
        db.commit()

        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.source_gmail_message_id == "sync-backfill-msg").count() == 1

    def test_6_concurrent_execution_race_results_in_one_db_row(self, db: Session, test_setup):
        partner, _, _ = test_setup
        person = schemas.PersonInfo(firstName="Concurrent", lastName="Tester", email="concurrent@example.com", location="Oxford")

        # Simulate concurrent insertion by calling create_manager_request directly
        r1 = create_manager_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="race-msg-777",
            partner_id=partner.id,
            allow_existing_lookup=False, # Bypass initial SELECT check to simulate race
        )

        r2 = create_manager_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="race-msg-777",
            partner_id=partner.id,
            allow_existing_lookup=False, # Bypass initial SELECT check to simulate race
        )

        assert r1.id == r2.id
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.source_gmail_message_id == "race-msg-777").count() == 1

    def test_7_database_uniqueness_conflict_handled_gracefully(self, db: Session, test_setup):
        partner, _, _ = test_setup
        person = schemas.PersonInfo(firstName="Graceful", lastName="User", email="graceful@example.com", location="Derby")

        req1 = intake_automated_email_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="graceful-msg-888",
            from_email="roster@puregym.com",
            partner_id=partner.id,
        )
        db.commit()

        # Direct duplicate creation attempt handles exception and returns original row
        req2 = create_manager_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="graceful-msg-888",
            partner_id=partner.id,
            allow_existing_lookup=False,
        )

        assert req1.id == req2.id

    def test_8_two_different_gmail_message_ids_create_distinct_requests(self, db: Session, test_setup):
        partner, _, _ = test_setup
        person = schemas.PersonInfo(firstName="Same", lastName="Person", email="sameperson@example.com", location="London")

        req1 = intake_automated_email_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="inbox-1-msg-id",
            from_email="roster@puregym.com",
            partner_id=partner.id,
        )
        db.commit()

        req2 = intake_automated_email_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="inbox-2-msg-id",
            from_email="roster@puregym.com",
            partner_id=partner.id,
        )
        db.commit()

        assert req1.id != req2.id
        assert req1.source_gmail_message_id == "inbox-1-msg-id"
        assert req2.source_gmail_message_id == "inbox-2-msg-id"

    def test_9_manager_form_requests_not_constrained_by_automated_uniqueness(self, db: Session, test_setup):
        partner, manager_user, _ = test_setup
        person = schemas.PersonInfo(firstName="Manager", lastName="Form", email="mform@example.com", location="London")

        # Submission 1 (null source_gmail_message_id)
        m1 = intake_manager_submission(
            db,
            person=person,
            action="Add",
            manager_id=manager_user.id,
            partner_id=partner.id,
        )
        db.commit()

        # Submission 2 (null source_gmail_message_id)
        m2 = intake_manager_submission(
            db,
            person=person,
            action="Add",
            manager_id=manager_user.id,
            partner_id=partner.id,
        )
        db.commit()

        assert m1.id != m2.id
        assert m1.source_gmail_message_id is None
        assert m2.source_gmail_message_id is None
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.person_email == "mform@example.com").count() == 2

    def test_10_duplicate_grouping_functions_alongside_request_uniqueness(self, db: Session, test_setup):
        partner, _, _ = test_setup
        person = schemas.PersonInfo(firstName="Grouped", lastName="User", email="grouped@example.com", location="London")

        r1 = intake_automated_email_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="group-msg-1",
            from_email="roster@puregym.com",
            partner_id=partner.id,
        )
        db.commit()

        r2 = intake_automated_email_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="group-msg-2",
            from_email="roster@puregym.com",
            partner_id=partner.id,
        )
        db.commit()

        assert r1.id != r2.id
        # Confirm duplicate grouping was performed and tags assigned
        assert r1.duplicate_group_id is not None or "confirmed duplicate" in r2.tags or "potential duplicate" in r2.tags
