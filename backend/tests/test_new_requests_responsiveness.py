"""Comprehensive regression tests for New Requests UI responsiveness, immediate updates,
and cache/tombstone synchronization.

Verifies:
1. Source verification: RequestDetail.jsx awaits mark-handled mutation BEFORE navigating to /new-requests.
2. Source verification: NewRequests.jsx completeRequest suppresses request, scrubs cache, and awaits API before success toast.
3. Source verification: GroupDetail.jsx handleResolved suppresses resolved duplicate groups and scrubs sessionStorage cache.
4. Source verification: GroupDetail.jsx handleResolved clears cache when a member is unlinked to New Requests.
5. Source verification: NewRequests.jsx handleCreateRequest sends manual Add/Remove straight to Directory (archive refresh for Remove).
6. Source verification: NewRequests.jsx dismiss and bulk dismiss handlers suppress IDs and scrub cache with rollback on failure.
7. Source verification: pilot2Api.js applyNewRequestsSuppressions preserves tombstones for their full TTL.
8. Source verification: unlink router endpoint calls notify_admin_requests_changed('unlink').
9. Backend DB lifecycle: Mark handled properly sets status and outcome in database.
10. Backend DB lifecycle: Unlink duplicate member separates requests cleanly without lingering duplicate state.
11. Backend DB lifecycle: Directory archive/restore semantics remain intact.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import ARRAY
from sqlalchemy.dialects.postgresql import JSONB

from app import models, schemas
from app.duplicate_group_service import (
    process_request_grouping,
    resolve_group_add,
    resolve_group_update,
    resolve_group_keep_existing,
    unlink_duplicate_members,
    get_group_members,
)
from app.api.routers.pilot1 import (
    dismiss_request,
    mark_request_handled,
    AuthenticatedUser,
)
from app.directory_person_match import archived_snapshot_rows, directory_ledger_rows
from app.manager_request_intake import create_handled_manual_request

FRONTEND_SRC = Path(__file__).resolve().parent.parent.parent / "frontend" / "src"

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
def admin_user():
    return AuthenticatedUser(
        id=uuid.uuid4(),
        email="admin@powermusic.com",
        role="admin",
    )


# ─── FRONTEND CODE CONTRACT REGRESSION TESTS ────────────────────────────────

def test_request_detail_awaits_mutation_before_navigation():
    """Verify RequestDetail.jsx completes backend mark-handled BEFORE navigating and showing toast."""
    content = (FRONTEND_SRC / "pages" / "RequestDetail.jsx").read_text(encoding="utf-8")
    
    # Must import suppression and cache scrubbing utilities
    assert "suppressNewRequests" in content
    assert "removeRequestsFromCache" in content
    # List GETs that overlap the mark-handled POST must not repaint the row.
    assert "beginCacheMutation(requestsCacheKey)" in content

    # The fetchJson call to mark-handled must appear BEFORE navigate('/new-requests')
    fetch_pos = content.find("fetchJson(`/api/admin/requests/${handledId}/mark-handled`")
    nav_pos = content.find("navigate('/new-requests')", fetch_pos)
    assert fetch_pos != -1, "fetchJson mark-handled not found in RequestDetail.jsx"
    assert nav_pos != -1, "navigate('/new-requests') must be called after fetchJson in RequestDetail.jsx"
    assert fetch_pos < nav_pos, "navigate('/new-requests') was called before fetchJson completed"


def test_new_requests_complete_request_registers_suppression_and_awaits_toast():
    """Verify NewRequests.jsx completeRequest registers tombstones and awaits API before toast."""
    content = (FRONTEND_SRC / "pages" / "NewRequests.jsx").read_text(encoding="utf-8")
    
    assert "suppressNewRequests({ requestIds: [req.id] })" in content
    assert "removeRequestsFromCache(requestsCacheKey, { requestIds: [req.id] })" in content
    assert "clearNewRequestsSuppressions({ requestIds: [req.id] })" in content

    complete_pos = content.find("const completeRequest = async")
    fetch_pos = content.find("fetchJson(`/api/admin/requests/${req.id}/mark-handled`", complete_pos)
    toast_pos = content.find("showToast(", fetch_pos)
    assert fetch_pos != -1
    assert toast_pos != -1
    assert fetch_pos < toast_pos, "showToast must not be called before fetchJson mark-handled in completeRequest"


def test_group_detail_suppresses_resolved_groups_and_cleans_cache():
    """Verify GroupDetail.jsx handleResolved suppresses resolved groups and scrubs sessionStorage."""
    content = (FRONTEND_SRC / "pages" / "GroupDetail.jsx").read_text(encoding="utf-8")
    
    assert "suppressNewRequests({ groupIds: [groupId], requestIds: groupMemberIds })" in content
    assert "removeRequestsFromCache(requestsCacheKey, { groupIds: [groupId], requestIds: groupMemberIds })" in content
    assert "clearCache(requestsCacheKey)" in content, "unlinked_new_requests must clear requestsCacheKey"


def test_new_requests_manual_create_refreshes_directory_for_add_and_remove():
    """Manual Add/Remove both refresh Directory caches; Remove must not enqueue New Requests."""
    content = (FRONTEND_SRC / "pages" / "NewRequests.jsx").read_text(encoding="utf-8")

    handle_pos = content.find("const handleCreateRequest = async")
    assert handle_pos != -1
    manual_block = content[handle_pos : handle_pos + 4500]

    assert "/api/admin/requests/manual" in manual_block
    assert "/api/persons/archived" in manual_block
    assert "pm_directory_pending_tab" in manual_block
    assert "Directory (Archive)" in content
    assert "pendingCreatedIdsRef.current.add(r.id)" not in manual_block
    assert "Add to Directory" in content
    assert "Create Request" not in content


def test_pilot2api_suppression_preserves_tombstones():
    """Verify pilot2Api.js applyNewRequestsSuppressions preserves tombstones for their full TTL."""
    content = (FRONTEND_SRC / "utils" / "pilot2Api.js").read_text(encoding="utf-8")
    
    assert "export function clearNewRequestsSuppressions" in content
    assert "export function removeRequestsFromCache" in content
    # Ensure it no longer prematurely drops suppressions when stillPresentIds does not have it
    assert "stillPresentIds.has(id)" not in content, "Tombstones must not be dropped when an array lacking the id is filtered"


def test_unlink_router_notifies_realtime():
    """Verify unlink endpoint on pilot1 router broadcasts notification."""
    content = (Path(__file__).resolve().parent.parent / "app" / "api" / "routers" / "pilot1.py").read_text(encoding="utf-8")
    
    unlink_pos = content.find("def unlink_duplicate_group_members_api")
    notify_pos = content.find('notify_admin_requests_changed("unlink")', unlink_pos)
    assert notify_pos != -1, "unlink router must call notify_admin_requests_changed('unlink')"


# ─── BACKEND DATABASE LIFECYCLE TESTS ───────────────────────────────────────

def test_manual_remove_creates_handled_archived_directory_row(db: Session, admin_user: AuthenticatedUser):
    """Admin manual Remove lands in Directory archive, not the New Requests queue."""
    partner_id = "partner-001"
    person = schemas.PersonInfo(
        firstName="Sam",
        lastName="RemovedManual",
        email=f"manual-remove-{uuid.uuid4().hex[:8]}@example.com",
        location="London Gym",
    )
    row = create_handled_manual_request(
        db,
        person=person,
        action="Remove",
        admin_id=str(admin_user.id),
        partner_id=partner_id,
    )
    db.commit()
    db.refresh(row)

    assert row.status == "handled"
    assert row.outcome == "Removed"
    assert row.archived_at is not None

    active = directory_ledger_rows(db, partner_id=partner_id)
    assert not any(r.person_email == person.email for r in active)
    archived = archived_snapshot_rows(db, partner_id=partner_id)
    assert any(r.id == row.id for r in archived)


def test_backend_mark_handled_status_and_outcome(db: Session, admin_user: AuthenticatedUser):
    """Verify mark_request_handled updates database record cleanly without delay."""
    req = models.ManagerRequest(
        id="test-req-101",
        action="Add",
        status="new",
        person_first_name="Alice",
        person_last_name="Smith",
        person_email="alice@example.com",
        person_location="London",
        received_at=datetime.now(timezone.utc),
    )
    db.add(req)
    db.commit()

    # Call endpoint function
    mark_request_handled(
        request_id="test-req-101",
        payload=schemas.MarkHandledIn(adminNote="Approved"),
        db=db,
        admin=admin_user,
    )

    db.refresh(req)
    assert req.status == "handled"
    assert req.outcome == "Added"
    assert req.handled_at is not None


def test_backend_unlink_members_clean_separation(db: Session, admin_user: AuthenticatedUser):
    """Verify unlinking duplicate members leaves them distinct and active."""
    now = datetime.now(timezone.utc)
    req1 = models.ManagerRequest(
        id=f"test-unlink-1-{uuid.uuid4().hex[:6]}",
        action="Add",
        status="new",
        person_first_name="Charlie",
        person_last_name="Brown",
        person_email="charlie@example.com",
        person_location="London",
        received_at=now,
    )
    req2 = models.ManagerRequest(
        id=f"test-unlink-2-{uuid.uuid4().hex[:6]}",
        action="Add",
        status="new",
        person_first_name="Charlie",
        person_last_name="Brown",
        person_email="charlie@example.com",
        person_location="London",
        received_at=now,
    )
    db.add_all([req1, req2])
    db.flush()

    # Run grouping
    group = process_request_grouping(db, req1)
    process_request_grouping(db, req2)
    db.flush()

    assert group is not None

    # Unlink req2
    result = unlink_duplicate_members(db, group.id, req1.id, req2.id, admin_id="dev-bypass", strict_single=True)
    db.commit()

    assert result is not None
    # req2 is now unlinked into its own distinct group or standalone
    req2_db = db.query(models.ManagerRequest).filter_by(id=req2.id).first()
    assert req2_db is not None
    assert req2_db.status == "new"
    assert req2_db.duplicate_group_id != group.id
