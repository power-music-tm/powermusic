"""Automated regression tests for Gmail push handling for non-allowlisted sender domains.

Verifies:
1. Roster-style email from a non-allowlisted domain creates no New Request and does not fail synchronization.
2. Allowlisted sender for the correct partner continues to create requests as expected.
3. Allowlisted sender associated with a different partner cannot create a request for destination inbox's partner.
4. A rejected/errored message does not prevent later valid messages in the same Gmail history batch from being processed.
5. Gmail history synchronization and cursor advancement remain correct when an ineligible message is skipped.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import ARRAY
from sqlalchemy.dialects.postgresql import JSONB

from app import models
from app.partner_allowlists import create_partner, create_automated_source
from app.pilot2 import sync, gmail
from app.automated_person_intake import intake_puregym_roster_message

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
def setup_partners_and_inbox(db: Session):
    partner_1 = create_partner(db, "Partner One")
    partner_2 = create_partner(db, "Partner Two")
    db.commit()

    # Partner 1 allowlist: @allowedp1.com
    source_p1 = create_automated_source(db, "allowedp1.com", partner_1.id)
    # Partner 2 allowlist: @allowedp2.com
    source_p2 = create_automated_source(db, "allowedp2.com", partner_2.id)
    db.commit()

    # Destination Inbox for Partner 1
    account_1 = models.EmailAccount(
        id="acc-1",
        email="inbox1@partner1.com",
        title="Inbox 1",
        partner_id=partner_1.id,
        status="Connected",
        gmail_history_id="100",
    )
    db.add(account_1)
    db.commit()

    return partner_1, partner_2, account_1


ROSTER_BODY = """\
Name: Alice Smith
Email: alice@example.com
Club: Central
"""


class TestNonAllowlistedPushHandling:
    def test_non_allowlisted_domain_creates_no_request_and_does_not_fail_sync(self, db: Session, setup_partners_and_inbox):
        partner_1, partner_2, account_1 = setup_partners_and_inbox

        # Message from domain not allowlisted for Partner 1 or Partner 2
        result = intake_puregym_roster_message(
            db,
            from_email="notifications@unallowlisted.com",
            from_name="Unallowlisted Gym",
            subject="PureGym Joinee",
            body=ROSTER_BODY,
            inbox_email=account_1.email,
        )

        assert result is False
        requests_count = db.query(models.ManagerRequest).count()
        assert requests_count == 0

    def test_domain_allowlisted_for_partner_2_only_is_skipped_for_partner_1_inbox(self, db: Session, setup_partners_and_inbox):
        partner_1, partner_2, account_1 = setup_partners_and_inbox

        # Message from @allowedp2.com arriving at Partner 1's inbox
        result = intake_puregym_roster_message(
            db,
            from_email="notifications@allowedp2.com",
            from_name="Partner Two Gym",
            subject="PureGym Joinee",
            body=ROSTER_BODY,
            inbox_email=account_1.email,
        )

        # Must return False without raising 409
        assert result is False
        assert db.query(models.ManagerRequest).count() == 0

    def test_allowlisted_sender_for_correct_partner_creates_request(self, db: Session, setup_partners_and_inbox):
        partner_1, partner_2, account_1 = setup_partners_and_inbox

        # Message from @allowedp1.com arriving at Partner 1's inbox
        result = intake_puregym_roster_message(
            db,
            from_email="notifications@allowedp1.com",
            from_name="Partner One Gym",
            subject="PureGym Joinee",
            body=ROSTER_BODY,
            inbox_email=account_1.email,
        )

        assert result is True
        requests = db.query(models.ManagerRequest).all()
        assert len(requests) == 1
        assert requests[0].partner_id == partner_1.id

    def test_cross_partner_conflict_error_isolation_in_history_sync(self, db: Session, setup_partners_and_inbox):
        partner_1, partner_2, account_1 = setup_partners_and_inbox

        msg1 = gmail.InboundMessage(
            gmail_message_id="msg-1",
            gmail_thread_id="th-1",
            from_email="sender@unallowlisted.com",
            from_name="Unallowlisted Sender",
            subject="PureGym Joinee",
            body=ROSTER_BODY,
            received_at=datetime.now(timezone.utc),
            label_ids=["INBOX"],
        )
        msg2 = gmail.InboundMessage(
            gmail_message_id="msg-2",
            gmail_thread_id="th-2",
            from_email="sender@allowedp1.com",
            from_name="Allowed Sender",
            subject="PureGym Joinee",
            body=ROSTER_BODY,
            received_at=datetime.now(timezone.utc),
            label_ids=["INBOX"],
        )

        def mock_get_message(account, message_id):
            if message_id == "msg-1":
                return msg1
            if message_id == "msg-2":
                return msg2
            return None

        history_response = {
            "historyId": "200",
            "history": [
                {
                    "messagesAdded": [
                        {"message": {"id": "msg-1"}},
                        {"message": {"id": "msg-2"}},
                    ]
                }
            ],
        }

        with patch.object(gmail, "list_history", return_value=history_response), \
             patch.object(gmail, "get_message", side_effect=mock_get_message), \
             patch.object(sync, "catch_up_recent_messages", return_value=0):

            changes = sync.sync_account_history(db, account_1)

        # Changes count should reflect valid processing, historyId updated to 200
        assert changes >= 1
        db.refresh(account_1)
        assert account_1.gmail_history_id == "200"

        # Manager request created only for msg2
        requests = db.query(models.ManagerRequest).all()
        assert len(requests) == 1
        assert requests[0].partner_id == partner_1.id

    def test_history_sync_continues_if_one_message_raises_unexpected_error(self, db: Session, setup_partners_and_inbox):
        partner_1, partner_2, account_1 = setup_partners_and_inbox

        msg1 = gmail.InboundMessage(
            gmail_message_id="msg-bad",
            gmail_thread_id="th-bad",
            from_email="error@example.com",
            from_name="Error Sender",
            subject="Error Subject",
            body="Error Body",
            received_at=datetime.now(timezone.utc),
            label_ids=["INBOX"],
        )
        msg2 = gmail.InboundMessage(
            gmail_message_id="msg-good",
            gmail_thread_id="th-good",
            from_email="sender@allowedp1.com",
            from_name="Allowed Sender",
            subject="PureGym Joinee",
            body=ROSTER_BODY,
            received_at=datetime.now(timezone.utc),
            label_ids=["INBOX"],
        )

        history_response = {
            "historyId": "300",
            "history": [
                {
                    "messagesAdded": [
                        {"message": {"id": "msg-bad"}},
                        {"message": {"id": "msg-good"}},
                    ]
                }
            ],
        }

        def mock_import_message(db, account, message, queue_ai=True):
            if message.gmail_message_id == "msg-bad":
                raise ValueError("Simulated unexpected processing error for bad message")
            return sync.import_message(db, account, message, queue_ai=queue_ai)

        with patch.object(gmail, "list_history", return_value=history_response), \
             patch.object(gmail, "get_message", side_effect=lambda acc, mid: msg1 if mid == "msg-bad" else msg2), \
             patch.object(sync, "import_message", side_effect=mock_import_message), \
             patch.object(sync, "catch_up_recent_messages", return_value=0):

            changes = sync.sync_account_history(db, account_1)

        # History cursor advanced to 300 despite msg-bad error
        db.refresh(account_1)
        assert account_1.gmail_history_id == "300"
