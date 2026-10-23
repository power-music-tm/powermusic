"""Explicit Directory multi-match selection — active-only targets (JD Gyms).

Archived/Removed Directory rows are never selectable for Add/Remove-and-Update.
Add against archived-only uses resolve_group_add (new active record).
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

from app import models, schemas
from app.directory_person_match import directory_ledger_rows
from app.duplicate_group_service import (
    _new_group_id,
    eligible_directory_person_ids_for_group,
    load_eligible_directory_person,
    resolve_group_add,
    resolve_group_delete_from_directory,
    resolve_group_update,
)
from app.intake_persons import get_lifecycle_history
from app.manager_request_tags import TAG_REMOVED

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


def _jd(db: Session) -> models.Partner:
    now = datetime.now(timezone.utc)
    p = models.Partner(
        id=f"partner-jd-{uuid.uuid4().hex[:8]}",
        name="JD Gyms",
        created_at=now,
        updated_at=now,
    )
    db.add(p)
    db.flush()
    return p


def _dir(
    db: Session,
    *,
    partner_id: str,
    first: str,
    last: str,
    email: str,
    location: str,
    handled_at: datetime,
    action: str = "Add",
    outcome: str = "Added",
    archived_at: datetime | None = None,
) -> models.ManagerRequest:
    row = models.ManagerRequest(
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
        archived_at=archived_at,
        partner_id=partner_id,
        tags=[TAG_REMOVED] if outcome == "Removed" else [],
    )
    db.add(row)
    db.flush()
    return row


def _req(
    db: Session,
    *,
    partner_id: str,
    first: str,
    last: str,
    email: str,
    location: str,
    action: str,
    received_at: datetime,
) -> models.ManagerRequest:
    row = models.ManagerRequest(
        id=f"req-{uuid.uuid4().hex[:8]}",
        person_first_name=first,
        person_last_name=last,
        person_email=email,
        person_location=location,
        action=action,
        status="new",
        received_at=received_at,
        partner_id=partner_id,
        tags=[],
    )
    db.add(row)
    db.flush()
    return row


def _group(
    db: Session,
    *,
    partner_id: str,
    primary_id: str,
    match_ids: list[str],
    members: list[models.ManagerRequest],
) -> models.DuplicateGroup:
    now = datetime.now(timezone.utc)
    g = models.DuplicateGroup(
        id=_new_group_id(),
        partner_id=partner_id,
        classification="potential_duplicate",
        status="active",
        created_at=now,
        directory_person_id=primary_id,
        representative_request_id=members[-1].id,
        resolution_metadata={"matched_directory_person_ids": list(match_ids)},
    )
    db.add(g)
    db.flush()
    for m in members:
        m.duplicate_group_id = g.id
    db.flush()
    return g


class TestExplicitDirectorySelection:
    def test_eligibility_excludes_archived_includes_active(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _jd(db)
        active = _dir(db, partner_id=partner.id, first="Alex", last="Kim", email="a.kim@jdgyms.co.uk", location="A", handled_at=now - timedelta(days=30))
        archived = _dir(db, partner_id=partner.id, first="Alex", last="Kim", email="a.kim@jdgyms.co.uk", location="B", handled_at=now - timedelta(days=20), action="Remove", outcome="Removed", archived_at=now - timedelta(days=5))
        incoming = _req(db, partner_id=partner.id, first="Alex", last="Kim", email="a.kim@jdgyms.co.uk", location="C", action="Add", received_at=now)
        group = _group(db, partner_id=partner.id, primary_id=archived.id, match_ids=[active.id, archived.id], members=[incoming])

        eligible = eligible_directory_person_ids_for_group(db, group)
        assert active.id in eligible
        assert archived.id not in eligible
        assert load_eligible_directory_person(db, group, active.id).id == active.id
        with pytest.raises(ValueError, match="Archived|eligible"):
            load_eligible_directory_person(db, group, archived.id)

    def test_add_updates_only_selected_of_three_active(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _jd(db)
        a = _dir(db, partner_id=partner.id, first="Blair", last="Ng", email="b.ng@jdgyms.co.uk", location="One", handled_at=now - timedelta(days=9))
        b = _dir(db, partner_id=partner.id, first="Blair", last="Ng", email="b.ng@jdgyms.co.uk", location="Two", handled_at=now - timedelta(days=6))
        c = _dir(db, partner_id=partner.id, first="Blair", last="Ng", email="b.ng@jdgyms.co.uk", location="Three", handled_at=now - timedelta(days=3))
        incoming = _req(db, partner_id=partner.id, first="Blair", last="Ng", email="b.ng@jdgyms.co.uk", location="Four", action="Add", received_at=now)
        group = _group(db, partner_id=partner.id, primary_id=a.id, match_ids=[a.id, b.id, c.id], members=[incoming])

        resolve_group_update(
            db,
            group,
            b,
            final_values=schemas.PersonInfo(firstName="Blair", lastName="Ng", email="b.ng@jdgyms.co.uk", location="Selected"),
            admin_id="dev-bypass",
            source_request_id=incoming.id,
        )
        db.flush()
        db.refresh(a)
        db.refresh(b)
        db.refresh(c)

        assert b.person_location == "Selected"
        assert a.person_location == "One"
        assert c.person_location == "Three"
        assert group.directory_person_id == b.id
        assert group.status == "resolved"

    def test_add_with_active_and_archived_updates_only_selected_active(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _jd(db)
        active_a = _dir(db, partner_id=partner.id, first="Chris", last="Ortiz", email="c.o@jdgyms.co.uk", location="North", handled_at=now - timedelta(days=8))
        active_b = _dir(db, partner_id=partner.id, first="Chris", last="Ortiz", email="c.o@jdgyms.co.uk", location="South", handled_at=now - timedelta(days=5))
        archived = _dir(db, partner_id=partner.id, first="Chris", last="Ortiz", email="c.o@jdgyms.co.uk", location="East", handled_at=now - timedelta(days=20), action="Remove", outcome="Removed", archived_at=now - timedelta(days=10))
        incoming = _req(db, partner_id=partner.id, first="Chris", last="Ortiz", email="c.o@jdgyms.co.uk", location="West", action="Add", received_at=now)
        group = _group(db, partner_id=partner.id, primary_id=active_a.id, match_ids=[active_a.id, active_b.id, archived.id], members=[incoming])

        # Same-email actives collapse to one representative (newest); archived excluded.
        eligible = eligible_directory_person_ids_for_group(db, group)
        assert eligible == {active_b.id}

        before_loc = archived.person_location
        before_arch = archived.archived_at
        before_hist = list(get_lifecycle_history(archived))
        before_a_loc = active_a.person_location

        resolve_group_update(
            db,
            group,
            active_b,
            final_values=schemas.PersonInfo(firstName="Chris", lastName="Ortiz", email="c.o@jdgyms.co.uk", location="West"),
            admin_id="dev-bypass",
            source_request_id=incoming.id,
        )
        db.flush()
        db.refresh(active_a)
        db.refresh(active_b)
        db.refresh(archived)

        assert active_b.person_location == "West" and active_b.archived_at is None
        assert active_a.person_location == before_a_loc
        assert archived.person_location == before_loc
        assert archived.archived_at is not None
        assert archived.outcome == "Removed"
        assert get_lifecycle_history(archived) == before_hist
        # Archive timestamp must not have been rewritten by the active update.
        assert archived.archived_at.replace(tzinfo=None) == before_arch.replace(tzinfo=None)

    def test_add_only_archived_creates_new_active_leaves_archive(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _jd(db)
        archived = _dir(
            db,
            partner_id=partner.id,
            first="Dana",
            last="Perez",
            email="d.p@jdgyms.co.uk",
            location="Old",
            handled_at=now - timedelta(days=15),
            action="Remove",
            outcome="Removed",
            archived_at=now - timedelta(days=7),
        )
        incoming = _req(db, partner_id=partner.id, first="Dana", last="Perez", email="d.p@jdgyms.co.uk", location="New", action="Add", received_at=now)
        group = _group(db, partner_id=partner.id, primary_id=archived.id, match_ids=[archived.id], members=[incoming])

        assert eligible_directory_person_ids_for_group(db, group) == set()
        with pytest.raises(ValueError, match="Archived|eligible"):
            load_eligible_directory_person(db, group, archived.id)
        with pytest.raises(ValueError, match="Archived"):
            resolve_group_update(
                db,
                group,
                archived,
                final_values=schemas.PersonInfo(firstName="Dana", lastName="Perez", email="d.p@jdgyms.co.uk", location="New"),
                admin_id="dev-bypass",
                source_request_id=incoming.id,
            )

        before_loc = archived.person_location
        before_hist = list(get_lifecycle_history(archived))

        created = resolve_group_add(
            db,
            group,
            final_values=schemas.PersonInfo(firstName="Dana", lastName="Perez", email="d.p@jdgyms.co.uk", location="New"),
            admin_id="dev-bypass",
            source_request_id=incoming.id,
        )
        db.flush()
        db.refresh(archived)

        assert created.id != archived.id
        assert created.outcome == "Added" and created.archived_at is None
        assert created.person_location == "New"
        assert archived.person_location == before_loc
        assert archived.outcome == "Removed" and archived.archived_at is not None
        assert get_lifecycle_history(archived) == before_hist
        assert any(r.id == created.id for r in directory_ledger_rows(db, partner_id=partner.id, limit=50))
        assert not any(r.id == archived.id for r in directory_ledger_rows(db, partner_id=partner.id, limit=50))

    def test_remove_archives_only_selected_of_three_active(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _jd(db)
        a = _dir(db, partner_id=partner.id, first="Evan", last="Quinn", email="e.q@jdgyms.co.uk", location="North", handled_at=now - timedelta(days=8))
        b = _dir(db, partner_id=partner.id, first="Evan", last="Quinn", email="e.q@jdgyms.co.uk", location="South", handled_at=now - timedelta(days=5))
        c = _dir(db, partner_id=partner.id, first="Evan", last="Quinn", email="e.q@jdgyms.co.uk", location="East", handled_at=now - timedelta(days=2))
        incoming = _req(db, partner_id=partner.id, first="Evan", last="Quinn", email="e.q@jdgyms.co.uk", location="West", action="Remove", received_at=now)
        group = _group(db, partner_id=partner.id, primary_id=a.id, match_ids=[a.id, b.id, c.id], members=[incoming])

        resolve_group_delete_from_directory(
            db,
            group,
            c,
            final_values=schemas.PersonInfo(firstName="Evan", lastName="Quinn", email="e.q@jdgyms.co.uk", location="West"),
            admin_id="dev-bypass",
            source_request_id=incoming.id,
        )
        db.flush()
        db.refresh(a)
        db.refresh(b)
        db.refresh(c)

        assert c.outcome == "Removed" and c.archived_at is not None and c.person_location == "West"
        assert a.outcome == "Added" and a.archived_at is None
        assert b.outcome == "Added" and b.archived_at is None

    def test_remove_rejects_archived_target(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _jd(db)
        archived = _dir(db, partner_id=partner.id, first="Fran", last="Ross", email="f.r@jdgyms.co.uk", location="York", handled_at=now - timedelta(days=10), action="Remove", outcome="Removed", archived_at=now - timedelta(days=3))
        incoming = _req(db, partner_id=partner.id, first="Fran", last="Ross", email="f.r@jdgyms.co.uk", location="Bath", action="Remove", received_at=now)
        group = _group(db, partner_id=partner.id, primary_id=archived.id, match_ids=[archived.id], members=[incoming])

        assert eligible_directory_person_ids_for_group(db, group) == set()
        with pytest.raises(ValueError, match="Archived"):
            resolve_group_delete_from_directory(
                db,
                group,
                archived,
                final_values=schemas.PersonInfo(firstName="Fran", lastName="Ross", email="f.r@jdgyms.co.uk", location="Bath"),
                admin_id="dev-bypass",
                source_request_id=incoming.id,
            )
        db.refresh(archived)
        assert archived.person_location == "York"

    def test_open_requests_are_not_eligible_directory_ids(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _jd(db)
        a = _dir(db, partner_id=partner.id, first="Ivy", last="Upton", email="i.u@jdgyms.co.uk", location="L1", handled_at=now - timedelta(days=2))
        peer = _req(db, partner_id=partner.id, first="Ivy", last="Upton", email="i.u@jdgyms.co.uk", location="L2", action="Add", received_at=now - timedelta(hours=1))
        incoming = _req(db, partner_id=partner.id, first="Ivy", last="Upton", email="i.u@jdgyms.co.uk", location="L3", action="Add", received_at=now)
        group = _group(db, partner_id=partner.id, primary_id=a.id, match_ids=[a.id], members=[peer, incoming])

        eligible = eligible_directory_person_ids_for_group(db, group)
        assert a.id in eligible
        assert peer.id not in eligible
        assert incoming.id not in eligible

    def test_add_against_active_stays_active(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _jd(db)
        active = _dir(db, partner_id=partner.id, first="Gabe", last="Singh", email="g.s@jdgyms.co.uk", location="Old", handled_at=now - timedelta(days=4))
        add1 = _req(db, partner_id=partner.id, first="Gabe", last="Singh", email="g.s@jdgyms.co.uk", location="New", action="Add", received_at=now)
        g1 = _group(db, partner_id=partner.id, primary_id=active.id, match_ids=[active.id], members=[add1])
        resolve_group_update(
            db,
            g1,
            active,
            final_values=schemas.PersonInfo(firstName="Gabe", lastName="Singh", email="g.s@jdgyms.co.uk", location="New"),
            admin_id="dev-bypass",
            source_request_id=add1.id,
        )
        db.flush()
        db.refresh(active)
        assert active.outcome == "Added" and active.archived_at is None and active.person_location == "New"
