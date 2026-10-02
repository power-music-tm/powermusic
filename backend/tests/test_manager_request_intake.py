"""Integration tests for manager + automated email request intake."""

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
    TAG_PARTNER_REQUEST,
    TAG_POTENTIAL_DUPLICATE,
    TAG_UNVERIFIED,
    TAG_VERIFIED,
)
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
def manager_id(db: Session) -> str:
    manager = (
        db.query(models.PowermusicUser)
        .filter(models.PowermusicUser.role == "manager")
        .first()
    )
    if manager is None:
        pytest.skip("No manager profile in database for intake tests")
    return str(manager.id)


def _person(**kwargs):
    defaults = dict(
        firstName="Sara",
        lastName="Malik",
        email=f"intake-test-{uuid.uuid4().hex[:8]}@example.com",
        location="Oxford",
    )
    defaults.update(kwargs)
    return schemas.PersonInfo(**defaults)


def _add_handled_directory_row(db: Session, person: schemas.PersonInfo, partner_id: str = "partner-001") -> models.ManagerRequest:
    row = models.ManagerRequest(
        id=f"test-handled-{uuid.uuid4().hex[:8]}",
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
        partner_id=partner_id,
    )
    db.add(row)
    db.flush()
    return row


class TestManagerRequestIntake:
    def test_auto_email_then_manager_same_email_diff_name_location(self, db: Session, manager_id: str):
        email = f"auto-then-mgr-{uuid.uuid4().hex[:8]}@example.com"
        auto_person = _person(email=email, firstName="Sara", lastName="Malik", location="Oxford")
        mgr_person = _person(email=email, firstName="Sara", lastName="Mal", location="Leeds")

        auto_row = intake_automated_email_request(
            db,
            person=auto_person,
            action="Remove",
            source_gmail_message_id=f"gmail-{uuid.uuid4().hex}",
        )
        db.flush()

        assert TAG_UNVERIFIED in auto_row.tags
        assert TAG_AUTO_MAIL in auto_row.tags
        assert auto_row.manager_id is None

        verified = intake_manager_submission(
            db,
            person=mgr_person,
            action="Remove",
            manager_id=manager_id,
            manager_notes="Manager confirmed leaver",
        )
        db.flush()

        assert verified.id != auto_row.id
        assert TAG_VERIFIED in verified.tags
        assert TAG_PARTNER_REQUEST in verified.tags
        assert TAG_AUTO_MAIL not in verified.tags
        assert TAG_CONFIRMED_DUPLICATE not in verified.tags
        assert TAG_POTENTIAL_DUPLICATE in verified.tags
        assert TAG_UNVERIFIED in auto_row.tags
        assert verified.manager_id is not None
        assert verified.person_last_name == "Mal"
        assert verified.person_location == "Leeds"

    def test_manager_first_then_auto_email_same_email_diff_name(self, db: Session, manager_id: str):
        email = f"mgr-then-auto-{uuid.uuid4().hex[:8]}@example.com"
        mgr_person = _person(email=email, firstName="Sara", lastName="Mal", location="Leeds")
        auto_person = _person(email=email, firstName="Sara", lastName="Malik", location="Oxford")

        mgr_row = intake_manager_submission(
            db,
            person=mgr_person,
            action="Add",
            manager_id=manager_id,
        )
        db.flush()

        assert TAG_VERIFIED in mgr_row.tags
        assert TAG_PARTNER_REQUEST in mgr_row.tags
        assert TAG_AUTO_MAIL not in mgr_row.tags

        linked = intake_automated_email_request(
            db,
            person=auto_person,
            action="Add",
            source_gmail_message_id=f"gmail-{uuid.uuid4().hex}",
        )
        db.flush()

        assert linked.id != mgr_row.id
        assert TAG_AUTO_MAIL in linked.tags
        assert linked.person_email == auto_person.email
        assert linked.intake_persons["autoMail"]["email"] == auto_person.email
        assert TAG_VERIFIED not in linked.tags
        assert TAG_PARTNER_REQUEST not in linked.tags
        assert TAG_CONFIRMED_DUPLICATE not in linked.tags
        assert TAG_POTENTIAL_DUPLICATE in linked.tags

    def test_admin_manual_creates_fresh_row(self, db: Session, manager_id: str):
        """Admin/manual submit should no longer reuse an existing request row."""

        suffix = uuid.uuid4().hex[:8]
        # Letter-only uniqueness so we do not collide with live New Requests rows.
        uniq = "".join("abcdefghijklmnop"[int(c, 16) % 16] for c in suffix)
        mgr_person = _person(
            email=f"nabs-{suffix}@gmail.com",
            firstName=f"Nabeeha{uniq}",
            lastName="Shafeeq",
            location=f"Islamabad {uniq}",
        )
        admin_person = _person(
            email=f"nabeeha-{suffix}@mail.com",
            firstName=f"Nabeeha{uniq}",
            lastName="Shafeeq",
            location=f"Islamabad {uniq}",
        )

        mgr_row = intake_manager_submission(
            db,
            person=mgr_person,
            action="Add",
            manager_id=manager_id,
        )
        db.flush()
        linked = intake_automated_email_request(
            db,
            person=mgr_person,
            action="Add",
            source_gmail_message_id=f"gmail-{uuid.uuid4().hex}",
        )
        db.flush()
        assert linked.id != mgr_row.id
        assert TAG_AUTO_MAIL in linked.tags

        admin_row = intake_manager_submission(
            db,
            person=admin_person,
            action="Add",
            manager_id=None,
            submitted_by=schemas.SubmittedBy(
                firstName="Mil",
                lastName="",
                email="",
                club="Manual entry",
            ),
        )
        db.flush()

        assert admin_row.id != mgr_row.id
        assert TAG_PARTNER_REQUEST in admin_row.tags
        assert TAG_AUTO_MAIL not in admin_row.tags
        assert admin_row.manager_id is None
        assert admin_row.person_email == admin_person.email

    def test_exact_duplicate_gets_confirmed_duplicate_status(self, db: Session, manager_id: str):
        person = _person(firstName="Arthur", lastName="John", email=f"exact-{uuid.uuid4().hex[:8]}@example.com", location="USA")
        start_count = db.query(models.ManagerRequest).count()
        intake_manager_submission(
            db,
            person=person,
            action="Add",
            manager_id=manager_id,
        )
        db.flush()

        duplicate = intake_manager_submission(
            db,
            person=_person(firstName="Arthur", lastName="John", email=person.email, location="USA"),
            action="Add",
            manager_id=manager_id,
        )
        db.flush()

        assert (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.person_email == person.email)
            .count()
            == 2
        )
        rows = (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.person_email == person.email)
            .order_by(models.ManagerRequest.id.asc())
            .all()
        )
        assert len(rows) == 2
        assert rows[0].person_first_name == "Arthur"
        assert rows[0].person_last_name == "John"
        assert rows[0].person_location == "USA"
        assert rows[0].tags.count(TAG_CONFIRMED_DUPLICATE) == 0
        assert TAG_CONFIRMED_DUPLICATE in duplicate.tags
        assert TAG_POTENTIAL_DUPLICATE not in duplicate.tags
        assert TAG_CONFIRMED_DUPLICATE not in rows[0].tags
        assert TAG_CONFIRMED_DUPLICATE in rows[1].tags

    def test_name_location_duplicate_gets_potential_duplicate_status(self, db: Session, manager_id: str):
        person = _person(firstName="Arthur", lastName="John", email=f"potential-{uuid.uuid4().hex[:8]}@example.com", location="USA")
        start_count = db.query(models.ManagerRequest).count()
        intake_manager_submission(
            db,
            person=person,
            action="Add",
            manager_id=manager_id,
        )
        db.flush()

        duplicate = intake_manager_submission(
            db,
            person=_person(firstName="Arthur", lastName="John", email=f"other-{uuid.uuid4().hex[:8]}@example.com", location="USA"),
            action="Add",
            manager_id=manager_id,
        )
        db.flush()

        assert db.query(models.ManagerRequest).count() == start_count + 2
        rows = (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.person_first_name == "Arthur")
            .filter(models.ManagerRequest.person_last_name == "John")
            .order_by(models.ManagerRequest.id.asc())
            .all()
        )
        assert len(rows) == 2
        assert TAG_POTENTIAL_DUPLICATE in duplicate.tags
        assert TAG_CONFIRMED_DUPLICATE not in duplicate.tags
        assert TAG_POTENTIAL_DUPLICATE not in rows[0].tags
        assert TAG_POTENTIAL_DUPLICATE in rows[1].tags

    def test_same_email_different_action_does_not_merge(self, db: Session, manager_id: str):
        email = f"action-mismatch-{uuid.uuid4().hex[:8]}@example.com"
        auto_person = _person(email=email)

        auto_row = intake_automated_email_request(
            db,
            person=auto_person,
            action="Remove",
            source_gmail_message_id=f"gmail-{uuid.uuid4().hex}",
        )
        db.flush()

        mgr_row = intake_manager_submission(
            db,
            person=_person(email=email, firstName="Sara", lastName="Mal", location="Leeds"),
            action="Add",
            manager_id=manager_id,
        )
        db.flush()

        assert mgr_row.id != auto_row.id
        assert TAG_AUTO_MAIL not in mgr_row.tags
        assert TAG_UNVERIFIED in auto_row.tags

    def test_already_exists_tag_on_email_only_directory_match(self, db: Session, manager_id: str):
        email = f"already-exists-{uuid.uuid4().hex[:8]}@example.com"
        directory_person = _person(email=email, firstName="Directory", lastName="Person", location="Bristol")
        _add_handled_directory_row(db, directory_person)

        submit_person = _person(email=email, firstName="Different", lastName="Name", location="London")
        row = intake_manager_submission(
            db,
            person=submit_person,
            action="Add",
            manager_id=manager_id,
        )
        db.flush()

        assert TAG_ALREADY_EXISTS in row.tags
