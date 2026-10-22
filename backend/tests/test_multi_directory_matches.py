"""Potential-duplicate grouping must surface ALL qualifying Directory records.

Previously process_request_grouping broke after the first directory hit (ordered by
newest handled_at), hiding equally valid matches from the admin UI.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.types import ARRAY

from app import models
from app.duplicate_group_service import (
    find_all_directory_matches_for_requests,
    process_request_grouping,
)

sqlite3.register_adapter(list, json.dumps)
sqlite3.register_adapter(dict, json.dumps)


@compiles(ARRAY, "sqlite")
def _compile_array(type_, compiler, **kw):
    return "JSON"


@compiles(JSONB, "sqlite")
def _compile_jsonb(type_, compiler, **kw):
    return "JSON"


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def _partner(db: Session, name: str = "PureGym") -> models.Partner:
    now = datetime.now(timezone.utc)
    partner = models.Partner(
        id=f"partner-{uuid.uuid4().hex[:8]}",
        name=name,
        created_at=now,
        updated_at=now,
    )
    db.add(partner)
    db.flush()
    return partner


def _dir_row(
    *,
    partner_id: str,
    first: str,
    last: str,
    email: str,
    location: str,
    handled_at: datetime,
    action: str = "Add",
    outcome: str = "Added",
) -> models.ManagerRequest:
    return models.ManagerRequest(
        id=f"dir-{uuid.uuid4().hex[:8]}",
        person_first_name=first,
        person_last_name=last,
        person_email=email,
        person_location=location,
        action=action,
        status="handled",
        outcome=outcome,
        handled_at=handled_at,
        received_at=handled_at,
        partner_id=partner_id,
    )


class TestMultiDirectoryMatches:
    def test_two_directory_records_both_linked_and_returned(self, db: Session):
        """Carl Johnson @ same email, two locations → both Directory hits for Alaska request."""
        now = datetime.now(timezone.utc)
        partner = _partner(db)

        older = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Johnson",
            email="cj@therealgmail.com",
            location="London",
            handled_at=now - timedelta(days=10),
        )
        newer = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Johnson",
            email="cj@therealgmail.com",
            location="England",
            handled_at=now - timedelta(days=1),
        )
        incoming = models.ManagerRequest(
            id=f"req-{uuid.uuid4().hex[:8]}",
            person_first_name="Carl",
            person_last_name="Johnson",
            person_email="cj@therealgmail.com",
            person_location="Alaska",
            action="Add",
            status="new",
            received_at=now,
            partner_id=partner.id,
        )
        db.add_all([older, newer, incoming])
        db.flush()

        group = process_request_grouping(db, incoming)
        db.flush()

        assert group is not None
        # Primary must NOT silently prefer the newest solely by date — stable
        # ranking prefers oldest handled when classifications are equal.
        assert group.directory_person_id == older.id

        stored_ids = (group.resolution_metadata or {}).get("matched_directory_person_ids") or []
        assert set(stored_ids) == {older.id, newer.id}

        live = find_all_directory_matches_for_requests(db, [incoming])
        assert {r.id for r in live} == {older.id, newer.id}

    def test_three_directory_records_all_returned(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        rows = [
            _dir_row(
                partner_id=partner.id,
                first="Alex",
                last="Rivera",
                email="alex.r@example.com",
                location=loc,
                handled_at=now - timedelta(days=offset),
            )
            for offset, loc in ((30, "A"), (20, "B"), (10, "C"))
        ]
        incoming = models.ManagerRequest(
            id=f"req-{uuid.uuid4().hex[:8]}",
            person_first_name="Alex",
            person_last_name="Rivera",
            person_email="alex.r@example.com",
            person_location="D",
            action="Add",
            status="new",
            received_at=now,
            partner_id=partner.id,
        )
        db.add_all([*rows, incoming])
        db.flush()

        group = process_request_grouping(db, incoming)
        db.flush()
        assert group is not None
        stored = set((group.resolution_metadata or {}).get("matched_directory_person_ids") or [])
        assert stored == {r.id for r in rows}
        live = find_all_directory_matches_for_requests(db, [incoming])
        assert {r.id for r in live} == {r.id for r in rows}

    def test_remove_request_also_gets_all_directory_matches(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        a = _dir_row(
            partner_id=partner.id,
            first="Sam",
            last="Lee",
            email="sam.lee@example.com",
            location="North",
            handled_at=now - timedelta(days=5),
        )
        b = _dir_row(
            partner_id=partner.id,
            first="Sam",
            last="Lee",
            email="sam.lee@example.com",
            location="South",
            handled_at=now - timedelta(days=2),
        )
        remove_req = models.ManagerRequest(
            id=f"req-{uuid.uuid4().hex[:8]}",
            person_first_name="Sam",
            person_last_name="Lee",
            person_email="sam.lee@example.com",
            person_location="West",
            action="Remove",
            status="new",
            received_at=now,
            partner_id=partner.id,
        )
        db.add_all([a, b, remove_req])
        db.flush()

        group = process_request_grouping(db, remove_req)
        db.flush()
        assert group is not None
        stored = set((group.resolution_metadata or {}).get("matched_directory_person_ids") or [])
        assert stored == {a.id, b.id}

    def test_other_partner_directory_never_included(self, db: Session):
        now = datetime.now(timezone.utc)
        pg = _partner(db, "PureGym")
        other = _partner(db, "Other Gym Co")
        same_partner = _dir_row(
            partner_id=pg.id,
            first="Pat",
            last="Kim",
            email="pat.kim@example.com",
            location="One",
            handled_at=now - timedelta(days=3),
        )
        foreign = _dir_row(
            partner_id=other.id,
            first="Pat",
            last="Kim",
            email="pat.kim@example.com",
            location="Two",
            handled_at=now - timedelta(days=1),
        )
        incoming = models.ManagerRequest(
            id=f"req-{uuid.uuid4().hex[:8]}",
            person_first_name="Pat",
            person_last_name="Kim",
            person_email="pat.kim@example.com",
            person_location="Three",
            action="Add",
            status="new",
            received_at=now,
            partner_id=pg.id,
        )
        db.add_all([same_partner, foreign, incoming])
        db.flush()

        group = process_request_grouping(db, incoming)
        db.flush()
        assert group is not None
        stored = set((group.resolution_metadata or {}).get("matched_directory_person_ids") or [])
        assert stored == {same_partner.id}
        assert foreign.id not in stored

    def test_single_match_unchanged(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        only = _dir_row(
            partner_id=partner.id,
            first="Nina",
            last="Park",
            email="nina@example.com",
            location="Solo",
            handled_at=now - timedelta(days=1),
        )
        incoming = models.ManagerRequest(
            id=f"req-{uuid.uuid4().hex[:8]}",
            person_first_name="Nina",
            person_last_name="Park",
            person_email="nina@example.com",
            person_location="Elsewhere",
            action="Add",
            status="new",
            received_at=now,
            partner_id=partner.id,
        )
        db.add_all([only, incoming])
        db.flush()

        group = process_request_grouping(db, incoming)
        db.flush()
        assert group is not None
        assert group.directory_person_id == only.id
        stored = (group.resolution_metadata or {}).get("matched_directory_person_ids") or []
        assert stored == [only.id]
