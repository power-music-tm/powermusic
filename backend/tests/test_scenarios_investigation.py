"""
Test suite verifying duplicate-matching fixes, unlinking workflows,
Requests 191/192 (dup-grp-cd3adfaddd18), and Scenarios A through E.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import ARRAY
from sqlalchemy.dialects.postgresql import JSONB

from app import models, schemas
from app.duplicate_matching import match_classification_for_partner
from app.duplicate_group_service import process_request_grouping, unlink_duplicate_members
from app.person_match import person_from_model

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


def test_scenario_c_requests_191_and_192_classification(db):
    """Scenario C: Verify requests 191 & 192 pairwise matching logic under field-match rules."""
    now = datetime.now(timezone.utc)
    req192 = models.ManagerRequest(
        id="test-req-192",
        partner_id="partner-003",
        person_first_name="Preston",
        person_last_name="Brooks",
        person_email="ps@gmail.com",
        person_location="Manchester",
        status="new",
        action="Add",
        received_at=now,
    )
    req191 = models.ManagerRequest(
        id="test-req-191",
        partner_id="partner-003",
        person_first_name="Preston",
        person_last_name="Smith",
        person_email="ps@gmail.com",
        person_location="London",
        status="new",
        action="Add",
        received_at=now,
    )
    db.add(req192)
    db.add(req191)
    db.flush()

    p192 = person_from_model(req192)
    p191 = person_from_model(req191)

    cls, score = match_classification_for_partner(p192, p191, is_healthtech=False, is_gll=False)
    assert cls == "potential_duplicate"


def test_scenario_a_unlink_then_one_new_match(db):
    """Scenario A: Unlinking separates a request, and a new matching request creates a group."""
    now = datetime.now(timezone.utc)
    r1 = models.ManagerRequest(
        id="req-a1",
        partner_id="partner-003",
        person_first_name="Lincoln",
        person_last_name="Wright",
        person_email="lincoln@example.com",
        person_location="London",
        status="new",
        action="Add",
        received_at=now,
    )
    r2 = models.ManagerRequest(
        id="req-a2",
        partner_id="partner-003",
        person_first_name="Linkoln",
        person_last_name="Wright",
        person_email="lincoln@example.com",
        person_location="London",
        status="new",
        action="Add",
        received_at=now,
    )
    db.add_all([r1, r2])
    db.flush()

    grp1 = process_request_grouping(db, r1)
    process_request_grouping(db, r2)
    db.flush()
    assert grp1 is not None
    assert r1.duplicate_group_id is not None
    assert r2.duplicate_group_id == r1.duplicate_group_id

    res = unlink_duplicate_members(db, grp1.id, r1.id, r2.id, admin_id=uuid.uuid4(), strict_single=True)
    db.flush()
    assert res is not None
    assert r2.duplicate_group_id is None

    r3 = models.ManagerRequest(
        id="req-a3",
        partner_id="partner-003",
        person_first_name="Linkoln",
        person_last_name="Wright",
        person_email="lincoln@example.com",
        person_location="London",
        status="new",
        action="Add",
        received_at=now,
    )
    db.add(r3)
    db.flush()

    grp_new = process_request_grouping(db, r3)
    db.flush()
    assert grp_new is not None
    assert r3.duplicate_group_id == grp_new.id
    assert r2.duplicate_group_id == grp_new.id


def test_scenario_d_legitimate_non_duplicate_pair(db):
    """Scenario D: Legitimate non-duplicate pair does not receive potential_duplicate classification."""
    now = datetime.now(timezone.utc)
    r1 = models.ManagerRequest(
        id="req-d1",
        partner_id="partner-003",
        person_first_name="John",
        person_last_name="Smith",
        person_email="john@example.com",
        person_location="London",
        status="new",
        received_at=now,
    )
    r2 = models.ManagerRequest(
        id="req-d2",
        partner_id="partner-003",
        person_first_name="Alice",
        person_last_name="Jones",
        person_email="alice@example.com",
        person_location="Manchester",
        status="new",
        received_at=now,
    )
    p1 = person_from_model(r1)
    p2 = person_from_model(r2)

    cls, _ = match_classification_for_partner(p1, p2, is_healthtech=False, is_gll=False)
    assert cls is None
