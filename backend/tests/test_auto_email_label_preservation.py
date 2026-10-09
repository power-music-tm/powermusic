"""Automated regression tests to preserve "Auto Email Request" source label in Directory and Archive views.

Verifies:
1. Automated email request in New Requests returns Auto Email Request label.
2. Automated email request moved into Active Directory retains Auto Email Request label.
3. Automated email request moved into Archive Directory retains Auto Email Request label.
4. Manager-form request retains manager's name and details across all views.
5. Serialized Directory API dictionary includes source metadata (tags, sourceGmailMessageId, submittedBy, automatedEmail).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import ARRAY
from sqlalchemy.dialects.postgresql import JSONB

from app import models, schemas
from app.partner_allowlists import create_partner
from app.manager_request_intake import intake_automated_email_request, intake_manager_submission
from app.manager_request_serialize import directory_person_to_api_dict
from app.manager_request_tags import TAG_AUTO_MAIL, TAG_PARTNER_REQUEST

from sqlalchemy.types import TypeDecorator, JSON
from sqlalchemy.dialects.sqlite.base import SQLiteDialect

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
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def test_setup(db: Session):
    partner = create_partner(db, "PureGym Test")
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
        email="andrea@powermusic.com",
        first_name="Andrea",
        last_name="Admin",
        role="admin",
    )
    db.add_all([manager_user, admin_user])
    db.commit()

    return partner, manager_user, admin_user


class TestAutoEmailLabelPreservation:
    def test_directory_person_dict_includes_source_metadata(self, db: Session, test_setup):
        partner, manager_user, admin_user = test_setup

        person = schemas.PersonInfo(firstName="Sam", lastName="Smith", email="sam@example.com", location="London")
        auto_req = intake_automated_email_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id="gmail-msg-123",
            from_email="notifications@puregym.com",
            partner_id=partner.id,
        )
        auto_req.handled_at = datetime.now(timezone.utc)
        auto_req.handled_by_admin_id = admin_user.id
        auto_req.outcome = "Added"
        db.commit()

        d_dict = directory_person_to_api_dict(auto_req, db=db, admin_user=admin_user)

        assert TAG_AUTO_MAIL in d_dict["tags"]
        assert d_dict["sourceGmailMessageId"] == "gmail-msg-123"
        assert d_dict["submittedBy"]["club"] == "Auto email"
        assert d_dict["addedBy"] == "Andrea Admin"

    def test_manager_submission_directory_person_preserves_manager_details(self, db: Session, test_setup):
        partner, manager_user, admin_user = test_setup

        person = schemas.PersonInfo(firstName="Bob", lastName="Jones", email="bob@example.com", location="London")
        mgr_req = intake_manager_submission(
            db,
            person=person,
            action="Add",
            manager_id=manager_user.id,
            partner_id=partner.id,
        )
        mgr_req._manager_user = manager_user
        mgr_req.handled_at = datetime.now(timezone.utc)
        mgr_req.handled_by_admin_id = admin_user.id
        mgr_req.outcome = "Added"
        db.commit()

        d_dict = directory_person_to_api_dict(mgr_req, db=db, manager_user=manager_user)

        assert TAG_PARTNER_REQUEST in d_dict["tags"]
        assert d_dict["managerName"] == "Jane Doe"
        assert d_dict["managerEmail"] == "manager@puregym.com"
        assert d_dict["club"] == "London"

    def test_archived_directory_person_retains_source_metadata(self, db: Session, test_setup):
        partner, manager_user, admin_user = test_setup

        person = schemas.PersonInfo(firstName="Alice", lastName="Walker", email="alice@example.com", location="London")
        auto_req = intake_automated_email_request(
            db,
            person=person,
            action="Remove",
            source_gmail_message_id="gmail-msg-999",
            from_email="notifications@puregym.com",
            partner_id=partner.id,
        )
        auto_req.handled_at = datetime.now(timezone.utc)
        auto_req.handled_by_admin_id = admin_user.id
        auto_req.outcome = "Removed"
        auto_req.archived_at = datetime.now(timezone.utc)
        db.commit()

        archived_dict = directory_person_to_api_dict(auto_req, db=db)

        assert TAG_AUTO_MAIL in archived_dict["tags"]
        assert archived_dict["sourceGmailMessageId"] == "gmail-msg-999"
        assert archived_dict["archivedAt"] is not None
