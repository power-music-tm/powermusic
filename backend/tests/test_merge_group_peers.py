"""Request History Merge must keep the group active for follow-on resolve actions."""

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

from app import models, schemas
from app.duplicate_group_service import (
    merge_group_peers,
    process_request_grouping,
    unlink_duplicate_members,
)
from app.duplicate_matching import are_requests_dismissed

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


def _partner(db: Session) -> models.Partner:
    now = datetime.now(timezone.utc)
    p = models.Partner(
        id=f"partner-{uuid.uuid4().hex[:8]}",
        name="PureGym",
        created_at=now,
        updated_at=now,
    )
    db.add(p)
    db.flush()
    return p


def _new_req(
    partner_id: str,
    *,
    location: str,
    received_at: datetime,
    first: str = "Rubab",
    last: str = "Zahra",
    email: str = "rb@gmail.com",
    action: str = "Add",
) -> models.ManagerRequest:
    return models.ManagerRequest(
        id=f"req-{uuid.uuid4().hex[:8]}",
        person_first_name=first,
        person_last_name=last,
        person_email=email,
        person_location=location,
        action=action,
        status="new",
        received_at=received_at,
        partner_id=partner_id,
    )


def _final(location: str = "Merged City") -> schemas.PersonInfo:
    return schemas.PersonInfo(
        firstName="Rubab",
        lastName="Zahra",
        email="rb@gmail.com",
        location=location,
    )


class TestMergeGroupPeers:
    def test_no_directory_keeps_group_active_and_persists_values(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        older = _new_req(partner.id, location="Pakistan", received_at=now - timedelta(minutes=20))
        newer = _new_req(partner.id, location="Austin", received_at=now - timedelta(minutes=5))
        db.add_all([older, newer])
        db.flush()

        group = process_request_grouping(db, older)
        group = process_request_grouping(db, newer) or group
        db.flush()
        assert group is not None
        assert group.status == "active"
        assert group.directory_person_id is None

        result = merge_group_peers(
            db,
            group.id,
            _final("Final Loc"),
            source_request_id=newer.id,
        )
        db.flush()
        assert result is not None
        assert result["survivorRequestId"] == newer.id
        assert older.id in result["deletedIds"]
        assert newer.id not in result["deletedIds"]

        db.refresh(group)
        db.refresh(newer)
        assert group.status == "active"
        assert group.resolved_at is None
        assert newer.duplicate_group_id == group.id
        assert newer.person_location == "Final Loc"
        assert db.query(models.ManagerRequest).filter_by(id=older.id).first() is None
        assert (
            db.query(models.ManagerRequest)
            .filter(
                models.ManagerRequest.duplicate_group_id == group.id,
                models.ManagerRequest.status == "new",
            )
            .count()
            == 1
        )

    def test_already_exists_preserves_directory_link(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        directory = models.ManagerRequest(
            id=f"dir-{uuid.uuid4().hex[:8]}",
            person_first_name="Rubab",
            person_last_name="Zahra",
            person_email="rb@gmail.com",
            person_location="HQ",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=now - timedelta(days=30),
            handled_at=now - timedelta(days=30),
            partner_id=partner.id,
        )
        older = _new_req(partner.id, location="India", received_at=now - timedelta(minutes=15))
        newer = _new_req(partner.id, location="England", received_at=now - timedelta(minutes=2))
        db.add_all([directory, older, newer])
        db.flush()

        group = models.DuplicateGroup(
            id=f"dup-grp-{uuid.uuid4().hex[:12]}",
            partner_id=partner.id,
            classification="already_exists",
            status="active",
            created_at=now,
            directory_person_id=directory.id,
            representative_request_id=newer.id,
        )
        db.add(group)
        db.flush()
        older.duplicate_group_id = group.id
        newer.duplicate_group_id = group.id
        db.flush()

        result = merge_group_peers(db, group.id, _final("England Updated"))
        db.flush()
        assert result is not None
        db.refresh(group)
        db.refresh(newer)
        assert group.status == "active"
        assert group.directory_person_id == directory.id
        assert newer.duplicate_group_id == group.id
        assert newer.person_location == "England Updated"
        assert db.query(models.ManagerRequest).filter_by(id=directory.id).first() is not None

    def test_transfers_lookalike_dismissals_onto_survivor(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        pakistan = _new_req(partner.id, location="Pakistan", received_at=now - timedelta(minutes=40))
        india = _new_req(partner.id, location="India", received_at=now - timedelta(minutes=30))
        denver = _new_req(partner.id, location="Denver", received_at=now - timedelta(minutes=10))
        austin = _new_req(partner.id, location="Austin", received_at=now - timedelta(minutes=1))
        db.add_all([pakistan, india, denver, austin])
        db.flush()

        group = None
        for req in (pakistan, india, denver, austin):
            group = process_request_grouping(db, req) or group
        db.flush()

        for peer in (pakistan, india):
            unlink_duplicate_members(
                db,
                group.id,
                request_id_1=denver.id,
                request_id_2=peer.id,
                admin_id="dev-bypass",
                strict_single=True,
            )
            db.flush()

        # Remaining: Denver + Austin still grouped (or re-grouped). Ensure both in one group.
        for req in (denver, austin):
            db.refresh(req)
        if denver.duplicate_group_id is None or austin.duplicate_group_id is None:
            # After unlinks Denver may be alone; put Denver+Austin in a fresh active group.
            g2 = models.DuplicateGroup(
                id=f"dup-grp-{uuid.uuid4().hex[:12]}",
                partner_id=partner.id,
                classification="potential_duplicate",
                status="active",
                created_at=now,
            )
            db.add(g2)
            db.flush()
            denver.duplicate_group_id = g2.id
            austin.duplicate_group_id = g2.id
            group = g2
            db.flush()
        else:
            group = (
                db.query(models.DuplicateGroup)
                .filter(models.DuplicateGroup.id == austin.duplicate_group_id)
                .first()
            )

        assert are_requests_dismissed(db, denver.id, pakistan.id)

        result = merge_group_peers(
            db,
            group.id,
            _final("Austin"),
            source_request_id=austin.id,
        )
        db.flush()
        assert result is not None
        assert result["survivorRequestId"] == austin.id

        db.refresh(group)
        db.refresh(austin)
        assert group.status == "active"
        assert austin.duplicate_group_id == group.id
        # Barrier that lived on Denver must survive on Austin after Denver is deleted.
        assert are_requests_dismissed(db, austin.id, pakistan.id)
        assert are_requests_dismissed(db, austin.id, india.id)
