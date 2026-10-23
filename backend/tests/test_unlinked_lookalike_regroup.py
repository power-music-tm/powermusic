"""Not-the-Same-Person peers must never be reunited by a third matching request."""

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
from app import schemas
from app.duplicate_group_service import (
    find_separated_lookalike_requests,
    merge_group_peers,
    process_request_grouping,
    reattach_to_lookalike,
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
    # autoflush=False: absorb must flush itself so newly attached members are visible.
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


def _new_req(partner_id: str, location: str, received_at: datetime) -> models.ManagerRequest:
    return models.ManagerRequest(
        id=f"req-{uuid.uuid4().hex[:8]}",
        person_first_name="Rubab",
        person_last_name="Zahra",
        person_email="rbr@gmail.com",
        person_location=location,
        action="Add",
        status="new",
        received_at=received_at,
        partner_id=partner_id,
    )


class TestUnlinkedLookalikeRegroup:
    def test_third_request_attaches_to_latest_only_and_surfaces_lookalikes(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)

        pakistan = _new_req(partner.id, "Pakistan", now - timedelta(minutes=50))
        austin = _new_req(partner.id, "Austin", now - timedelta(minutes=40))
        india = _new_req(partner.id, "India", now - timedelta(minutes=30))
        england = _new_req(partner.id, "England", now - timedelta(minutes=20))
        denver = _new_req(partner.id, "Denver", now - timedelta(minutes=10))
        db.add_all([pakistan, austin, india, england, denver])
        db.flush()

        group = None
        for req in (pakistan, austin, india, england, denver):
            group = process_request_grouping(db, req) or group
        db.flush()
        assert group is not None
        assert (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.duplicate_group_id == group.id)
            .count()
            == 5
        )

        # Unlink four peers against Denver (latest remaining representative).
        for peer in (pakistan, austin, india, england):
            unlink_duplicate_members(
                db,
                group.id,
                request_id_1=denver.id,
                request_id_2=peer.id,
                admin_id="dev-bypass",
                strict_single=True,
            )
            db.flush()

        # Denver may be alone → group dismissed; peers are ungrouped.
        for peer in (pakistan, austin, india, england, denver):
            db.refresh(peer)
            assert peer.duplicate_group_id is None

        # New request arrives — should attach to latest open match only (Denver).
        incoming = _new_req(partner.id, "New York", now)
        db.add(incoming)
        db.flush()
        new_group = process_request_grouping(db, incoming)
        db.flush()

        assert new_group is not None
        member_ids = {
            m.id
            for m in db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.duplicate_group_id == new_group.id)
            .all()
        }
        assert member_ids == {incoming.id, denver.id}, (
            f"Expected only incoming+Denver, got {member_ids}"
        )

        lookalikes = find_separated_lookalike_requests(db, new_group, [incoming, denver])
        lookalike_ids = {r.id for r in lookalikes}
        assert lookalike_ids == {pakistan.id, austin.id, india.id, england.id}

    def test_reattach_requires_single_member_then_moves_to_chosen_lookalike(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)

        pakistan = _new_req(partner.id, "Pakistan", now - timedelta(minutes=50))
        austin = _new_req(partner.id, "Austin", now - timedelta(minutes=40))
        india = _new_req(partner.id, "India", now - timedelta(minutes=30))
        england = _new_req(partner.id, "England", now - timedelta(minutes=20))
        denver = _new_req(partner.id, "Denver", now - timedelta(minutes=10))
        db.add_all([pakistan, austin, india, england, denver])
        db.flush()

        group = None
        for req in (pakistan, austin, india, england, denver):
            group = process_request_grouping(db, req) or group
        db.flush()

        for peer in (pakistan, austin, india, england):
            unlink_duplicate_members(
                db,
                group.id,
                request_id_1=denver.id,
                request_id_2=peer.id,
                admin_id="dev-bypass",
                strict_single=True,
            )
            db.flush()

        incoming = _new_req(partner.id, "New York", now)
        db.add(incoming)
        db.flush()
        new_group = process_request_grouping(db, incoming)
        db.flush()
        assert new_group is not None

        # Still two members → reattach must be refused until Merge.
        assert reattach_to_lookalike(db, new_group.id, india.id) is None

        # Simulate peers_merge: keep latest (incoming), drop Denver from the group.
        denver.duplicate_group_id = None
        db.flush()
        db.refresh(new_group)

        assert are_requests_dismissed(db, incoming.id, india.id) or are_requests_dismissed(
            db, denver.id, india.id
        )

        result = reattach_to_lookalike(db, new_group.id, india.id)
        db.flush()
        assert result is not None
        assert result["targetRequestId"] == india.id
        assert result["sourceRequestId"] == incoming.id

        db.refresh(incoming)
        db.refresh(india)
        db.refresh(pakistan)
        db.refresh(new_group)

        assert incoming.duplicate_group_id == india.duplicate_group_id == result["newGroupId"]
        assert pakistan.duplicate_group_id != result["newGroupId"]
        assert new_group.status == "dismissed"
        assert not are_requests_dismissed(db, incoming.id, india.id)
        # Other lookalikes stay dismissed vs the original Denver peer barrier /
        # remain outside the new group.
        assert pakistan.duplicate_group_id is None or pakistan.duplicate_group_id != result["newGroupId"]
        assert austin.duplicate_group_id != result["newGroupId"] or austin.duplicate_group_id is None
        assert england.duplicate_group_id != result["newGroupId"] or england.duplicate_group_id is None

    def test_peers_merge_keeps_lookalikes_out_and_reattach_stays_visible(self, db: Session):
        """After Merge, dismissed lookalikes must not rejoin; Attach must leave a visible group."""
        now = datetime.now(timezone.utc)
        partner = _partner(db)

        pakistan = _new_req(partner.id, "Pakistan", now - timedelta(minutes=50))
        india = _new_req(partner.id, "India", now - timedelta(minutes=30))
        denver = _new_req(partner.id, "Denver", now - timedelta(minutes=10))
        db.add_all([pakistan, india, denver])
        db.flush()

        group = None
        for req in (pakistan, india, denver):
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

        incoming = _new_req(partner.id, "New York", now)
        db.add(incoming)
        db.flush()
        new_group = process_request_grouping(db, incoming)
        db.flush()
        assert new_group is not None

        member_ids = {
            m.id
            for m in db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.duplicate_group_id == new_group.id)
            .all()
        }
        assert member_ids == {incoming.id, denver.id}

        result = merge_group_peers(
            db,
            new_group.id,
            schemas.PersonInfo(
                firstName="Rubab",
                lastName="Zahra",
                email="rbr@gmail.com",
                location="New York",
            ),
            source_request_id=incoming.id,
            admin_id="dev-bypass",
        )
        db.flush()
        assert result is not None
        assert result["survivorRequestId"] == incoming.id
        assert result["memberCount"] == 1

        db.refresh(new_group)
        db.refresh(incoming)
        db.refresh(pakistan)
        db.refresh(india)

        assert new_group.status == "active"
        assert incoming.duplicate_group_id == new_group.id
        # Merged-away Denver's Not-the-Same-Person barriers live on the survivor.
        assert are_requests_dismissed(db, incoming.id, pakistan.id)
        assert are_requests_dismissed(db, incoming.id, india.id)
        assert pakistan.duplicate_group_id is None
        assert india.duplicate_group_id is None
        assert (
            db.query(models.ManagerRequest)
            .filter(models.ManagerRequest.duplicate_group_id == new_group.id)
            .count()
            == 1
        )

        attached = reattach_to_lookalike(db, new_group.id, india.id, admin_id="dev-bypass")
        db.flush()
        assert attached is not None
        db.refresh(incoming)
        db.refresh(india)
        db.refresh(pakistan)
        dest = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == attached["newGroupId"])
            .first()
        )
        assert dest is not None
        assert dest.status == "active"
        assert dest.representative_request_id in {incoming.id, india.id}
        assert incoming.duplicate_group_id == india.duplicate_group_id == dest.id
        # Other lookalikes stay out of the attached destination.
        assert pakistan.duplicate_group_id != dest.id
