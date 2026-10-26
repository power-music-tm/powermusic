"""Regression tests for duplicate group request deletion.

Deleting any new request in a duplicate group cascades to every other new
member of that group (confirmed and potential). Late arrivals can be excluded
by freezing also_delete_ids at Delete-confirm open.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal
from app.duplicate_group_service import (
    _new_group_id,
    _sync_group_representative_and_tags,
    admin_delete_requests,
    collect_selective_dismiss_targets,
    finalize_group_after_selective_dismiss,
    get_dismiss_impact,
    get_group_members,
)
from app.request_visibility import STATUS_ADMIN_DELETED, manager_visible_status


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
        session.rollback()
    finally:
        session.close()


def _create_request(
    db: Session,
    *,
    first_name: str,
    last_name: str,
    email: str,
    location: str,
    received_at: datetime,
    status: str = "new",
    action: str = "Add",
    manager_id=None,
    tags: list | None = None,
) -> models.ManagerRequest:
    req = models.ManagerRequest(
        id=f"test-del-{uuid.uuid4().hex[:10]}",
        received_at=received_at,
        handled_at=None,
        manager_id=manager_id,
        handled_by_admin_id=None,
        person_first_name=first_name,
        person_last_name=last_name,
        person_email=email,
        person_location=location,
        action=action,
        manager_notes="",
        admin_notes="",
        tags=tags or [],
        status=status,
        outcome=None,
        duplicate_group_id=None,
    )
    db.add(req)
    db.flush()
    return req


def _create_group(
    db: Session,
    requests: list[models.ManagerRequest],
    classification: str = "confirmed_duplicate",
) -> models.DuplicateGroup:
    now = datetime.now(timezone.utc)
    group = models.DuplicateGroup(
        id=_new_group_id(),
        partner_id=None,
        classification=classification,
        status="active",
        created_at=now,
        directory_person_id=None,
        representative_request_id=None,
    )
    db.add(group)
    db.flush()

    for r in requests:
        r.duplicate_group_id = group.id

    _sync_group_representative_and_tags(db, group, member_requests=requests)
    db.flush()
    return group


def _dismiss_request_logic(
    db: Session,
    target_req: models.ManagerRequest,
    *,
    also_delete_ids: list[str] | None = None,
    admin_id: str = "dev-bypass",
) -> tuple[list[models.ManagerRequest], list[models.ManagerRequest]]:
    """Helper simulating dismiss_request cascade + group finalize."""
    group_id = target_req.duplicate_group_id
    requests_to_dismiss, survivors = collect_selective_dismiss_targets(
        db,
        target_req,
        also_delete_ids=also_delete_ids,
    )

    admin_delete_requests(db, [r.id for r in requests_to_dismiss])

    if group_id:
        group = (
            db.query(models.DuplicateGroup)
            .filter(models.DuplicateGroup.id == group_id)
            .first()
        )
        if group and group.status == "active":
            finalize_group_after_selective_dismiss(
                db,
                group,
                {s.id for s in survivors},
                admin_id,
            )

    db.flush()
    return requests_to_dismiss, survivors


class TestGroupRequestDeletion:
    def test_delete_cascades_to_all_new_group_members(self, db: Session):
        """Deleting one member deletes every other new peer in the group."""
        t0 = datetime.now(timezone.utc) - timedelta(hours=3)
        t1 = datetime.now(timezone.utc) - timedelta(hours=2)
        t2 = datetime.now(timezone.utc) - timedelta(hours=1)
        t3 = datetime.now(timezone.utc)

        r_target = _create_request(
            db, first_name="Alice", last_name="Brown", email="alice@example.com",
            location="Leeds", received_at=t0,
        )
        r_confirmed = _create_request(
            db, first_name="Alice", last_name="Brown", email="alice@example.com",
            location="Leeds", received_at=t1,
        )
        r_pot1 = _create_request(
            db, first_name="Alyce", last_name="Brown", email="alice@example.com",
            location="Leeds", received_at=t2,
        )
        r_pot2 = _create_request(
            db, first_name="Alice", last_name="Brown", email="alice@example.com",
            location="York", received_at=t3,
        )

        group = _create_group(db, [r_target, r_confirmed, r_pot1, r_pot2])

        dismissed, survivors = _dismiss_request_logic(db, r_target)

        assert {d.id for d in dismissed} == {r_target.id, r_confirmed.id, r_pot1.id, r_pot2.id}
        assert survivors == []

        for row in (r_target, r_confirmed, r_pot1, r_pot2):
            db.refresh(row)
            assert row.status == STATUS_ADMIN_DELETED
            assert row.duplicate_group_id is None

        db.refresh(group)
        assert group.status in {"dismissed", "resolved"} or get_group_members(db, group.id) == []

    def test_frozen_also_delete_ids_leave_late_arrivals(self, db: Session):
        """also_delete_ids=[] deletes only the target; peers listed as survivors stay."""
        t0 = datetime.now(timezone.utc) - timedelta(days=2)
        t1 = datetime.now(timezone.utc)

        r_older = _create_request(
            db, first_name="Dave", last_name="Miller", email="dmiller@example.com",
            location="London", received_at=t0,
        )
        r_newer = _create_request(
            db, first_name="David", last_name="Miller", email="davidm@example.com",
            location="London", received_at=t1,
        )
        group = _create_group(db, [r_older, r_newer], classification="potential_duplicate")

        dismissed, survivors = _dismiss_request_logic(db, r_older, also_delete_ids=[])

        assert [d.id for d in dismissed] == [r_older.id]
        assert [s.id for s in survivors] == [r_newer.id]

        db.refresh(r_older)
        db.refresh(r_newer)
        db.refresh(group)
        assert r_older.status == STATUS_ADMIN_DELETED
        assert r_newer.status == "new"
        assert r_newer.duplicate_group_id is None or group.representative_request_id == r_newer.id

    def test_dismiss_impact_lists_all_siblings(self, db: Session):
        t0 = datetime.now(timezone.utc) - timedelta(minutes=30)
        t1 = datetime.now(timezone.utc) - timedelta(minutes=20)
        t2 = datetime.now(timezone.utc) - timedelta(minutes=10)

        r_target = _create_request(
            db, first_name="Emma", last_name="Watson", email="emma@cinema.com",
            location="Oxford", received_at=t0,
        )
        r_exact = _create_request(
            db, first_name="Emma", last_name="Watson", email="emma@cinema.com",
            location="Oxford", received_at=t1,
        )
        r_pot = _create_request(
            db, first_name="Em", last_name="Watson", email="em@cinema.com",
            location="Oxford", received_at=t2,
        )
        _create_group(db, [r_target, r_exact, r_pot])

        impact = get_dismiss_impact(db, r_target.id)

        assert impact["requestId"] == r_target.id
        assert set(impact["confirmedSiblingIds"]) == {r_exact.id, r_pot.id}
        assert impact["confirmedSiblingCount"] == 2
        assert impact["potentialSiblingIds"] == []
        assert impact["potentialSiblingCount"] == 0

    def test_portal_group_delete_marks_all_handled_for_manager(self, db: Session):
        user = db.query(models.PowermusicUser).first()
        if user is None:
            pytest.skip("needs at least one powermusic_users row")
        from app.manager_request_tags import TAG_VERIFIED

        now = datetime.now(timezone.utc)
        r1 = _create_request(
            db, first_name="Maaz", last_name="Ali", email="ma@gmail.com",
            location="vector1", received_at=now - timedelta(minutes=10),
            manager_id=user.id, tags=[TAG_VERIFIED],
        )
        r2 = _create_request(
            db, first_name="Maaz", last_name="Ali", email="ma@gmail.com",
            location="vector2", received_at=now - timedelta(minutes=5),
            manager_id=user.id, tags=[TAG_VERIFIED],
        )
        _create_group(db, [r1, r2], classification="potential_duplicate")

        _dismiss_request_logic(db, r2)
        db.refresh(r1)
        db.refresh(r2)

        assert r1.status == STATUS_ADMIN_DELETED
        assert r2.status == STATUS_ADMIN_DELETED
        assert manager_visible_status(r1) == "handled"
        assert manager_visible_status(r2) == "handled"
