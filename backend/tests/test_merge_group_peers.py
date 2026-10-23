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
    collect_selective_dismiss_targets,
    merge_group_peers,
    process_request_grouping,
    release_group_peers_after_mark_handled,
    resolve_group_add,
    resolve_group_add_as_new,
    resolve_group_delete_from_directory,
    resolve_group_keep_existing,
    resolve_group_keep_existing_and_archive,
    resolve_group_mark_removed,
    resolve_group_update,
    unlink_duplicate_members,
)
from app.duplicate_matching import (
    are_requests_dismissed,
    get_all_confirmed_nickname_pairs,
    get_all_rejected_nickname_pairs,
    get_answered_nickname_pair_keys,
    record_confirmed_nickname_pair,
    record_rejected_nickname_pair,
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

    def test_member_ids_snapshot_leaves_late_arrival(self, db: Session):
        """Merge only the confirm-open peers; a peer that joined mid-modal stays."""
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        older = _new_req(partner.id, location="Pakistan", received_at=now - timedelta(minutes=20))
        newer = _new_req(partner.id, location="Austin", received_at=now - timedelta(minutes=5))
        late = _new_req(partner.id, location="Denver", received_at=now - timedelta(seconds=30))
        db.add_all([older, newer, late])
        db.flush()

        group = process_request_grouping(db, older)
        group = process_request_grouping(db, newer) or group
        group = process_request_grouping(db, late) or group
        db.flush()
        assert group is not None

        # Admin opened Merge when only older+newer were listed.
        result = merge_group_peers(
            db,
            group.id,
            _final("Austin"),
            source_request_id=newer.id,
            member_ids=[older.id, newer.id],
        )
        db.flush()
        assert result is not None
        assert result["survivorRequestId"] == newer.id
        assert older.id in result["deletedIds"]
        assert late.id not in result["deletedIds"]

        db.refresh(group)
        db.refresh(newer)
        db.refresh(late)
        assert group.status == "active"
        assert newer.duplicate_group_id == group.id
        assert late.duplicate_group_id == group.id
        assert db.query(models.ManagerRequest).filter_by(id=older.id).first() is None
        remaining = (
            db.query(models.ManagerRequest)
            .filter(
                models.ManagerRequest.duplicate_group_id == group.id,
                models.ManagerRequest.status == "new",
            )
            .all()
        )
        assert {m.id for m in remaining} == {newer.id, late.id}


class TestResolveGroupAddSnapshot:
    def test_member_ids_leaves_late_arrival_against_new_directory(self, db: Session):
        """Add to Directory only resolves confirm-open peers; late peer re-groups vs Directory."""
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        older = _new_req(partner.id, location="Hogwarts", received_at=now - timedelta(minutes=20))
        newer = _new_req(partner.id, location="Hogwarts", received_at=now - timedelta(minutes=5))
        late = _new_req(partner.id, location="Hogwarts", received_at=now - timedelta(seconds=30))
        db.add_all([older, newer, late])
        db.flush()

        group = process_request_grouping(db, older)
        group = process_request_grouping(db, newer) or group
        group = process_request_grouping(db, late) or group
        db.flush()
        assert group is not None
        assert group.directory_person_id is None

        dir_row = resolve_group_add(
            db,
            group,
            final_values=_final("Hogwarts"),
            admin_id="dev-bypass",
            partner_id=partner.id,
            source_request_id=newer.id,
            member_ids=[older.id, newer.id],
        )
        db.flush()

        assert dir_row.id == newer.id
        assert dir_row.status == "handled"
        assert dir_row.outcome == "Added"
        assert db.query(models.ManagerRequest).filter_by(id=older.id).first() is None

        db.refresh(group)
        db.refresh(late)
        assert group.status == "resolved"
        assert late.status == "new"
        assert late.duplicate_group_id is not None
        assert late.duplicate_group_id != group.id

        late_group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == late.duplicate_group_id)
            .first()
        )
        assert late_group is not None
        assert late_group.status == "active"
        assert late_group.directory_person_id == dir_row.id


class TestMarkHandledLateArrival:
    def test_remove_user_leaves_late_peer_against_removed_directory(self, db: Session):
        """Confirm Remove User: peer that joined mid-modal re-groups vs Directory."""
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        target = _new_req(
            partner.id,
            location="Hogwarts",
            received_at=now - timedelta(minutes=5),
            action="Remove",
            first="Arthur",
            last="OShea",
        )
        late = _new_req(
            partner.id,
            location="Hogwarts",
            received_at=now - timedelta(seconds=20),
            action="Remove",
            first="Arthur",
            last="OShea",
        )
        db.add_all([target, late])
        db.flush()

        group = process_request_grouping(db, target)
        group = process_request_grouping(db, late) or group
        db.flush()
        assert group is not None
        assert target.duplicate_group_id == group.id
        assert late.duplicate_group_id == group.id

        target.status = "handled"
        target.outcome = "Removed"
        target.handled_at = now
        target.archived_at = now
        db.flush()

        release_group_peers_after_mark_handled(db, target, admin_id="dev-bypass")
        db.flush()

        db.refresh(target)
        db.refresh(late)
        db.refresh(group)
        assert target.duplicate_group_id is None
        assert target.status == "handled"
        assert group.status == "resolved"
        assert late.status == "new"
        assert late.duplicate_group_id is not None
        assert late.duplicate_group_id != group.id
        late_group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == late.duplicate_group_id)
            .first()
        )
        assert late_group is not None
        assert late_group.status == "active"
        assert late_group.directory_person_id == target.id

    def test_add_user_leaves_late_peer_against_added_directory(self, db: Session):
        """Confirm Add User: peer that joined mid-modal re-groups vs Directory."""
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        target = _new_req(
            partner.id,
            location="Hogwarts",
            received_at=now - timedelta(minutes=5),
            action="Add",
            first="Harry",
            last="Potter",
        )
        late = _new_req(
            partner.id,
            location="Hogwarts",
            received_at=now - timedelta(seconds=20),
            action="Add",
            first="Harry",
            last="Potter",
        )
        db.add_all([target, late])
        db.flush()

        group = process_request_grouping(db, target)
        group = process_request_grouping(db, late) or group
        db.flush()
        assert group is not None

        target.status = "handled"
        target.outcome = "Added"
        target.handled_at = now
        target.archived_at = None
        db.flush()

        release_group_peers_after_mark_handled(db, target, admin_id="dev-bypass")
        db.flush()

        db.refresh(target)
        db.refresh(late)
        db.refresh(group)
        assert target.duplicate_group_id is None
        assert target.status == "handled"
        assert target.outcome == "Added"
        assert group.status == "resolved"
        assert late.status == "new"
        assert late.duplicate_group_id is not None
        assert late.duplicate_group_id != group.id
        late_group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == late.duplicate_group_id)
            .first()
        )
        assert late_group is not None
        assert late_group.status == "active"
        assert late_group.directory_person_id == target.id


class TestNicknamePairAnswersOnce:
    def test_yes_and_no_are_recorded_once_and_flip(self, db: Session):
        row = record_confirmed_nickname_pair(db, "Kiara", "Kierra", admin_id="dev-bypass")
        db.flush()
        assert row is not None
        assert "kiara|kierra" in get_answered_nickname_pair_keys(db)
        assert ("kiara", "kierra") in get_all_confirmed_nickname_pairs(db)

        again = record_confirmed_nickname_pair(db, "Kierra", "Kiara", admin_id="dev-bypass")
        db.flush()
        assert again.id == row.id

        rej = record_rejected_nickname_pair(db, "Kiara", "Kierra", admin_id="dev-bypass")
        db.flush()
        assert rej is not None
        assert get_all_confirmed_nickname_pairs(db) == set()
        assert ("kiara", "kierra") in get_all_rejected_nickname_pairs(db)
        assert "kiara|kierra" in get_answered_nickname_pair_keys(db)


class TestDismissAlsoDeleteFreeze:
    def test_late_arrival_not_in_frozen_also_delete_ids_survives(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        target = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(minutes=20),
            first="Harry", last="Potter", email="hp@test.com",
        )
        known = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(minutes=5),
            first="Harry", last="Potter", email="hp@test.com",
        )
        late = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(seconds=20),
            first="Harry", last="Potter", email="hp@test.com",
        )
        db.add_all([target, known, late])
        db.flush()
        group = process_request_grouping(db, target)
        group = process_request_grouping(db, known) or group
        group = process_request_grouping(db, late) or group
        db.flush()
        assert group is not None

        dismissed, survivors = collect_selective_dismiss_targets(
            db,
            target,
            also_delete_ids=[known.id],
        )
        assert {d.id for d in dismissed} == {target.id, known.id}
        assert {s.id for s in survivors} == {late.id}


class TestResolveUpdateSnapshot:
    def test_update_directory_leaves_late_arrival_vs_updated_directory(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        directory = models.ManagerRequest(
            id=f"dir-{uuid.uuid4().hex[:8]}",
            person_first_name="Manual",
            person_last_name="Test",
            person_email="old@gmail.com",
            person_location="Hogwarts",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=now - timedelta(days=30),
            handled_at=now - timedelta(days=30),
            partner_id=partner.id,
        )
        current = _new_req(
            partner.id,
            location="Hogwarts",
            received_at=now - timedelta(minutes=5),
            first="Manual",
            last="Test",
            email="mt@gmail.com",
        )
        late = _new_req(
            partner.id,
            location="Hogwarts",
            received_at=now - timedelta(seconds=20),
            first="Manual",
            last="Test",
            email="mt2@gmail.com",
        )
        db.add_all([directory, current, late])
        db.flush()

        group = models.DuplicateGroup(
            id=f"dup-grp-{uuid.uuid4().hex[:12]}",
            partner_id=partner.id,
            classification="already_exists",
            status="active",
            created_at=now,
            directory_person_id=directory.id,
            representative_request_id=current.id,
        )
        db.add(group)
        db.flush()
        current.duplicate_group_id = group.id
        late.duplicate_group_id = group.id
        db.flush()

        resolve_group_update(
            db,
            group,
            directory,
            final_values=schemas.PersonInfo(
                firstName="Manual",
                lastName="Test",
                email="mt@gmail.com",
                location="Hogwarts",
            ),
            admin_id="dev-bypass",
            source_request_id=current.id,
            member_ids=[current.id],
        )
        db.flush()

        db.refresh(directory)
        assert directory.person_email == "mt@gmail.com"
        assert db.query(models.ManagerRequest).filter_by(id=current.id).first() is None

        db.refresh(late)
        db.refresh(group)
        assert group.status == "resolved"
        assert late.status == "new"
        assert late.duplicate_group_id is not None
        assert late.duplicate_group_id != group.id
        late_group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == late.duplicate_group_id)
            .first()
        )
        assert late_group is not None
        assert late_group.directory_person_id == directory.id


class TestAddAsNewSnapshot:
    def test_add_as_new_leaves_late_arrival_open(self, db: Session):
        """Keep Existing and Add New: late peer stays and re-groups vs Directory."""
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        directory = models.ManagerRequest(
            id=f"dir-{uuid.uuid4().hex[:8]}",
            person_first_name="Kierra",
            person_last_name="Smith",
            person_email="ks@gmail.com",
            person_location="Hogwarts",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=now - timedelta(days=30),
            handled_at=now - timedelta(days=30),
            partner_id=partner.id,
        )
        current = models.ManagerRequest(
            id=f"req-{uuid.uuid4().hex[:8]}",
            person_first_name="Kiara",
            person_last_name="Smith",
            person_email="kiara@gmail.com",
            person_location="Hogwarts",
            action="Add",
            status="new",
            received_at=now - timedelta(minutes=5),
            partner_id=partner.id,
        )
        late = models.ManagerRequest(
            id=f"req-{uuid.uuid4().hex[:8]}",
            person_first_name="Kiara",
            person_last_name="Smith",
            person_email="kiara2@gmail.com",
            person_location="Hogwarts",
            action="Add",
            status="new",
            received_at=now - timedelta(seconds=20),
            partner_id=partner.id,
        )
        db.add_all([directory, current, late])
        db.flush()

        group = models.DuplicateGroup(
            id=f"dup-grp-{uuid.uuid4().hex[:12]}",
            partner_id=partner.id,
            classification="already_exists",
            status="active",
            created_at=now,
            directory_person_id=directory.id,
            representative_request_id=current.id,
        )
        db.add(group)
        db.flush()
        current.duplicate_group_id = group.id
        late.duplicate_group_id = group.id
        db.flush()

        dir_row = resolve_group_add_as_new(
            db,
            group,
            final_values=schemas.PersonInfo(
                firstName="Kiara",
                lastName="Smith",
                email="kiara@gmail.com",
                location="Hogwarts",
            ),
            admin_id="dev-bypass",
            partner_id=partner.id,
            source_request_id=current.id,
            member_ids=[current.id],
        )
        db.flush()

        assert dir_row.id == current.id
        assert dir_row.status == "handled"
        assert dir_row.outcome == "Added"
        db.refresh(directory)
        assert directory.outcome == "Added"
        assert directory.id != dir_row.id

        db.refresh(late)
        db.refresh(group)
        assert group.status == "resolved"
        assert late.status == "new"
        assert late.duplicate_group_id is not None
        assert late.duplicate_group_id != group.id
        late_group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == late.duplicate_group_id)
            .first()
        )
        assert late_group is not None
        # Late peer should link to the new Directory person (and may also match old).
        assert late_group.directory_person_id == dir_row.id


class TestKeepExistingSnapshot:
    def test_keep_existing_deletes_only_snapshot_leaves_late_vs_directory(self, db: Session):
        """Keep Existing deletes confirm-open peers only; late peer re-groups vs Directory."""
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        directory = models.ManagerRequest(
            id=f"dir-{uuid.uuid4().hex[:8]}",
            person_first_name="Rubab",
            person_last_name="Zahra",
            person_email="rb@gmail.com",
            person_location="Hogwarts",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=now - timedelta(days=30),
            handled_at=now - timedelta(days=30),
            partner_id=partner.id,
        )
        current = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(minutes=5),
        )
        late = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(seconds=20),
        )
        db.add_all([directory, current, late])
        db.flush()

        group = models.DuplicateGroup(
            id=f"dup-grp-{uuid.uuid4().hex[:12]}",
            partner_id=partner.id,
            classification="already_exists",
            status="active",
            created_at=now,
            directory_person_id=directory.id,
            representative_request_id=current.id,
        )
        db.add(group)
        db.flush()
        current.duplicate_group_id = group.id
        late.duplicate_group_id = group.id
        db.flush()

        count = resolve_group_keep_existing(
            db,
            group,
            admin_id="dev-bypass",
            member_ids=[current.id],
        )
        db.flush()

        assert count == 1
        assert db.query(models.ManagerRequest).filter_by(id=current.id).first() is None
        db.refresh(directory)
        assert directory.status == "handled"
        assert directory.outcome == "Added"

        db.refresh(late)
        db.refresh(group)
        assert group.status == "resolved"
        assert late.status == "new"
        assert late.duplicate_group_id is not None
        assert late.duplicate_group_id != group.id
        late_group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == late.duplicate_group_id)
            .first()
        )
        assert late_group is not None
        assert late_group.directory_person_id == directory.id


class TestResolveRemoveSnapshots:
    def test_mark_removed_leaves_late_arrival_against_removed_directory(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        older = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(minutes=20), action="Remove",
        )
        newer = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(minutes=5), action="Remove",
        )
        late = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(seconds=30), action="Remove",
        )
        db.add_all([older, newer, late])
        db.flush()

        group = process_request_grouping(db, older)
        group = process_request_grouping(db, newer) or group
        group = process_request_grouping(db, late) or group
        db.flush()
        assert group is not None

        resolve_group_mark_removed(
            db,
            group,
            final_values=_final("Hogwarts"),
            admin_id="dev-bypass",
            partner_id=partner.id,
            source_request_id=newer.id,
            member_ids=[older.id, newer.id],
        )
        db.flush()

        db.refresh(newer)
        db.refresh(late)
        db.refresh(group)
        assert newer.status == "handled"
        assert newer.outcome == "Removed"
        assert db.query(models.ManagerRequest).filter_by(id=older.id).first() is None
        assert group.status == "resolved"
        assert late.status == "new"
        assert late.duplicate_group_id is not None
        assert late.duplicate_group_id != group.id
        late_group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == late.duplicate_group_id)
            .first()
        )
        assert late_group is not None
        assert late_group.directory_person_id == newer.id

    def test_keep_existing_and_archive_leaves_late_arrival_vs_directory(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        directory = models.ManagerRequest(
            id=f"dir-{uuid.uuid4().hex[:8]}",
            person_first_name="Rubab",
            person_last_name="Zahra",
            person_email="rb@gmail.com",
            person_location="Hogwarts",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=now - timedelta(days=30),
            handled_at=now - timedelta(days=30),
            partner_id=partner.id,
        )
        older = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(minutes=20), action="Remove",
        )
        newer = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(minutes=5), action="Remove",
        )
        late = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(seconds=30), action="Remove",
        )
        db.add_all([directory, older, newer, late])
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
        late.duplicate_group_id = group.id
        db.flush()

        archived = resolve_group_keep_existing_and_archive(
            db,
            group,
            final_values=_final("Hogwarts"),
            admin_id="dev-bypass",
            source_request_id=newer.id,
            member_ids=[older.id, newer.id],
        )
        db.flush()

        assert archived.id == newer.id
        assert archived.status == "handled"
        assert archived.outcome == "Removed"
        assert archived.archived_at is not None
        assert db.query(models.ManagerRequest).filter_by(id=older.id).first() is None
        db.refresh(directory)
        assert directory.status == "handled"
        assert directory.outcome == "Added"

        db.refresh(late)
        db.refresh(group)
        assert group.status == "resolved"
        assert late.status == "new"
        assert late.duplicate_group_id is not None
        assert late.duplicate_group_id != group.id
        late_group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == late.duplicate_group_id)
            .first()
        )
        assert late_group is not None
        assert late_group.directory_person_id == directory.id

    def test_delete_from_directory_leaves_late_arrival_vs_removed_directory(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        directory = models.ManagerRequest(
            id=f"dir-{uuid.uuid4().hex[:8]}",
            person_first_name="Rubab",
            person_last_name="Zahra",
            person_email="rb@gmail.com",
            person_location="Hogwarts",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=now - timedelta(days=30),
            handled_at=now - timedelta(days=30),
            partner_id=partner.id,
        )
        older = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(minutes=20), action="Remove",
        )
        newer = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(minutes=5), action="Remove",
        )
        late = _new_req(
            partner.id, location="Hogwarts", received_at=now - timedelta(seconds=30), action="Remove",
        )
        db.add_all([directory, older, newer, late])
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
        late.duplicate_group_id = group.id
        db.flush()

        resolve_group_delete_from_directory(
            db,
            group,
            directory_person=directory,
            final_values=_final("Hogwarts"),
            admin_id="dev-bypass",
            source_request_id=newer.id,
            member_ids=[older.id, newer.id],
        )
        db.flush()

        db.refresh(directory)
        db.refresh(late)
        db.refresh(group)
        assert directory.outcome == "Removed"
        assert db.query(models.ManagerRequest).filter_by(id=older.id).first() is None
        assert db.query(models.ManagerRequest).filter_by(id=newer.id).first() is None
        assert group.status == "resolved"
        assert late.status == "new"
        assert late.duplicate_group_id is not None
        assert late.duplicate_group_id != group.id
        late_group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == late.duplicate_group_id)
            .first()
        )
        assert late_group is not None
        assert late_group.directory_person_id == directory.id
