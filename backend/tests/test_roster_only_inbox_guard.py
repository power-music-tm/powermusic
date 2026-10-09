"""Tests for roster_only inbox flag and email/attachment persistence guard."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app import models, schemas
from app.pilot2 import gmail, sync
from app.database import SessionLocal


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
        session.rollback()
    finally:
        session.close()


def _mock_inbound_message(**kwargs) -> gmail.InboundMessage:
    defaults = dict(
        gmail_message_id=f"msg-{uuid.uuid4().hex[:12]}",
        gmail_thread_id=f"thread-{uuid.uuid4().hex[:12]}",
        label_ids=["INBOX"],
        from_name="Test Sender",
        from_email="sender@example.com",
        to_emails=["inbox@example.com"],
        cc_emails=[],
        subject="Test Subject",
        body="Name: Harry Potter\nEmail: hp@gmail.com\nClub: Hogwarts",
        html_body=None,
        snippet="Test snippet",
        received_at=datetime.now(timezone.utc),
        attachments=[],
    )
    defaults.update(kwargs)
    return gmail.InboundMessage(**defaults)


class TestRosterOnlyInboxGuard:
    def test_roster_email_in_roster_only_inbox_creates_request_and_no_email_row(self, db: Session):
        """Roster email in a roster_only=True inbox creates a ManagerRequest and NO Email row."""
        account_email = f"roster-inbox-{uuid.uuid4().hex[:8]}@powermusic.com"
        account = models.EmailAccount(
            id=f"inbox-{uuid.uuid4().hex[:6]}",
            email=account_email,
            title="Roster Intake Inbox",
            status="Connected",
            partner_id="partner-001",
            roster_only=True,
        )
        db.add(account)
        db.flush()

        msg = _mock_inbound_message(
            from_email="nabeeha529@gmail.com",
            to_emails=[account_email],
            subject="PureGym Joinee",
            body="Name: Harry Potter\nEmail: hp@gmail.com\nClub: Hogwarts",
        )

        res = sync.import_message(db, account, msg, queue_ai=False)
        db.commit()

        # Must return None (no Email model returned)
        assert res is None

        # Check ManagerRequest was created
        req = (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.person_email == "hp@gmail.com")
            .first()
        )
        assert req is not None

        # Check NO Email row was created
        email_row = (
            db.query(models.Email)
            .filter(models.Email.gmail_message_id == msg.gmail_message_id)
            .first()
        )
        assert email_row is None

    def test_non_roster_email_in_roster_only_inbox_is_ignored(self, db: Session):
        """Non-roster email in a roster_only=True inbox returns None and creates NO Email/Attachment rows."""
        account_email = f"roster-inbox-{uuid.uuid4().hex[:8]}@powermusic.com"
        account = models.EmailAccount(
            id=f"inbox-{uuid.uuid4().hex[:6]}",
            email=account_email,
            title="Roster Intake Inbox",
            status="Connected",
            partner_id="partner-001",
            roster_only=True,
        )
        db.add(account)
        db.flush()

        # Bank alert / CRM verification email (non-roster email)
        msg = _mock_inbound_message(
            from_email="alerts@bank.com",
            to_emails=[account_email],
            subject="Account Transaction Details",
            body="Your account was debited $50.00.",
        )

        res = sync.import_message(db, account, msg, queue_ai=False)
        db.commit()

        # Must return None
        assert res is None

        # Check NO Email row was created
        email_row = (
            db.query(models.Email)
            .filter(models.Email.gmail_message_id == msg.gmail_message_id)
            .first()
        )
        assert email_row is None

    def test_non_roster_email_in_non_roster_inbox_creates_email_row(self, db: Session):
        """Non-roster email in a roster_only=False inbox creates an Email row for Pilot 2 support inbox."""
        account_email = f"support-inbox-{uuid.uuid4().hex[:8]}@powermusic.com"
        account = models.EmailAccount(
            id=f"inbox-{uuid.uuid4().hex[:6]}",
            email=account_email,
            title="Customer Support Inbox",
            status="Connected",
            partner_id="partner-001",
            roster_only=False,
        )
        db.add(account)
        db.flush()

        # Customer enquiry email
        msg = _mock_inbound_message(
            from_email="customer@example.com",
            to_emails=[account_email],
            subject="Enquiry about subscription",
            body="Hello, I have a question about my pricing plan.",
        )

        res = sync.import_message(db, account, msg, queue_ai=False)
        db.commit()

        # Must return the created Email row
        assert res is not None
        assert res.gmail_message_id == msg.gmail_message_id
        assert res.account_email == account_email
