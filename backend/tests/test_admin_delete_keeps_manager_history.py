"""Admin Delete / duplicate merges must not remove requests from the manager portal.

Verifies:
1. Admin Delete hides a manager portal request from admin but keeps it, unchanged
   (Pending stays Pending, Handled stays Handled), for the manager.
2. Requests no manager can see are still permanently deleted.
3. Duplicates merged into a still-open request show Pending to their manager, then
   Handled (with the survivor's outcome) once the survivor is added / removed.
4. Chained merges resolve to the final survivor.
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
    merge_requests_into,
    sync_requests_merged_into,
)
from app.manager_request_tags import TAG_VERIFIED
from app.request_visibility import (
    STATUS_ADMIN_DELETED,
    STATUS_MERGED,
    admin_visible_filter,
    manager_status_expr,
    manager_visible_status,
)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
        session.rollback()
    finally:
        session.close()


@pytest.fixture
def manager_id(db: Session):
    user = db.query(models.PowermusicUser).first()
    if user is None:
        pytest.skip("needs at least one powermusic_users row")
    return user.id


def _create_request(
    db: Session,
    *,
    first_name: str,
    received_at: datetime,
    manager_id=None,
    status: str = "new",
    outcome: str | None = None,
) -> models.ManagerRequest:
    req = models.ManagerRequest(
        id=f"test-hide-{uuid.uuid4().hex[:10]}",
        received_at=received_at,
        handled_at=None if status == "new" else datetime.now(timezone.utc),
        manager_id=manager_id,
        person_first_name=first_name,
        person_last_name="Keeper",
        person_email=f"{first_name.lower()}.keeper@test.com",
        person_location="London",
        action="Add",
        manager_notes="",
        admin_notes="",
        tags=[TAG_VERIFIED] if manager_id else [],
        status=status,
        outcome=outcome,
    )
    db.add(req)
    db.flush()
    return req


def _create_group(db: Session, requests: list[models.ManagerRequest]) -> models.DuplicateGroup:
    group = models.DuplicateGroup(
        id=_new_group_id(),
        partner_id=None,
        classification="confirmed_duplicate",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db.add(group)
    db.flush()
    for r in requests:
        r.duplicate_group_id = group.id
    _sync_group_representative_and_tags(db, group, member_requests=requests)
    db.flush()
    return group


def _admin_can_see(db: Session, request_id: str) -> bool:
    return (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.id == request_id, admin_visible_filter())
        .first()
        is not None
    )


def _manager_status_in_sql(db: Session, request_id: str) -> str:
    return (
        db.query(manager_status_expr())
        .filter(models.ManagerRequest.id == request_id)
        .scalar()
    )


class TestAdminDeleteKeepsManagerHistory:

    def test_delete_pending_portal_request_stays_pending_for_manager(self, db: Session, manager_id):
        now = datetime.now(timezone.utc)
        r1 = _create_request(db, first_name="Ava", received_at=now - timedelta(minutes=5), manager_id=manager_id)
        r2 = _create_request(db, first_name="Ava", received_at=now, manager_id=manager_id)
        group = _create_group(db, [r1, r2])

        assert admin_delete_requests(db, [r1.id]) == 1
        db.refresh(r1)
        db.refresh(group)

        assert r1.status == STATUS_ADMIN_DELETED
        assert r1.duplicate_group_id is None
        assert group.representative_request_id != r1.id
        assert not _admin_can_see(db, r1.id)
        assert manager_visible_status(r1) == "new"
        assert _manager_status_in_sql(db, r1.id) == "new"

    def test_delete_handled_directory_row_stays_handled_for_manager(self, db: Session, manager_id):
        row = _create_request(
            db,
            first_name="Ben",
            received_at=datetime.now(timezone.utc),
            manager_id=manager_id,
            status="handled",
            outcome="Added",
        )

        assert admin_delete_requests(db, [row.id]) == 1
        db.refresh(row)

        assert row.status == STATUS_ADMIN_DELETED
        assert not _admin_can_see(db, row.id)
        assert manager_visible_status(row) == "handled"
        assert row.outcome == "Added"

    def test_delete_non_portal_request_is_permanent(self, db: Session):
        row = _create_request(db, first_name="Cara", received_at=datetime.now(timezone.utc))

        assert admin_delete_requests(db, [row.id]) == 1
        assert db.query(models.ManagerRequest).filter(models.ManagerRequest.id == row.id).first() is None

    def test_merged_duplicate_pending_until_survivor_handled(self, db: Session, manager_id):
        now = datetime.now(timezone.utc)
        peer = _create_request(db, first_name="Dan", received_at=now - timedelta(minutes=5), manager_id=manager_id)
        survivor = _create_request(db, first_name="Dan", received_at=now, manager_id=manager_id)
        _create_group(db, [peer, survivor])

        merge_requests_into(db, [peer.id], survivor)
        db.refresh(peer)

        assert peer.status == STATUS_MERGED
        assert peer.merged_into_request_id == survivor.id
        assert peer.duplicate_group_id is None
        assert not _admin_can_see(db, peer.id)
        assert manager_visible_status(peer) == "new"

        survivor.status = "handled"
        survivor.outcome = "Added"
        survivor.handled_at = datetime.now(timezone.utc)
        db.flush()
        assert sync_requests_merged_into(db, survivor) == 1
        db.refresh(peer)

        assert manager_visible_status(peer) == "handled"
        assert _manager_status_in_sql(db, peer.id) == "handled"
        assert peer.outcome == "Added"
        assert peer.handled_at == survivor.handled_at

    def test_chained_merge_follows_final_survivor(self, db: Session, manager_id):
        now = datetime.now(timezone.utc)
        first = _create_request(db, first_name="Eve", received_at=now - timedelta(minutes=10), manager_id=manager_id)
        middle = _create_request(db, first_name="Eve", received_at=now - timedelta(minutes=5), manager_id=manager_id)
        directory_row = _create_request(
            db,
            first_name="Eve",
            received_at=now,
            status="handled",
            outcome="Removed",
        )

        merge_requests_into(db, [first.id], middle)
        merge_requests_into(db, [middle.id], directory_row)
        db.refresh(first)
        db.refresh(middle)

        assert first.merged_into_request_id == directory_row.id
        assert middle.merged_into_request_id == directory_row.id
        assert manager_visible_status(first) == "handled"
        assert first.outcome == "Removed"
        assert manager_visible_status(middle) == "handled"
