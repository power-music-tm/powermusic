"""JD Gyms only: Add/Remove request × active/archived Directory status transitions.

Covers:
1. Remove request + active Directory → archive + update (via delete-from-directory UI path).
2. Add request + archived/Removed Directory → restore to active + update (resolve-update).
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
from app.directory_person_match import archived_snapshot_rows, directory_ledger_rows
from app.duplicate_group_service import (
    _new_group_id,
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


def _jd_partner(db: Session) -> models.Partner:
    now = datetime.now(timezone.utc)
    partner = models.Partner(
        id=f"partner-jd-{uuid.uuid4().hex[:8]}",
        name="JD Gyms",
        created_at=now,
        updated_at=now,
    )
    db.add(partner)
    db.flush()
    return partner


def _dir_row(
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
    tags: list | None = None,
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
        tags=list(tags or []),
    )
    db.add(row)
    db.flush()
    return row


def _open_request(
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
    directory_id: str,
    members: list[models.ManagerRequest],
    classification: str = "potential_duplicate",
) -> models.DuplicateGroup:
    now = datetime.now(timezone.utc)
    group = models.DuplicateGroup(
        id=_new_group_id(),
        partner_id=partner_id,
        classification=classification,
        status="active",
        created_at=now,
        directory_person_id=directory_id,
        representative_request_id=members[-1].id if members else None,
    )
    db.add(group)
    db.flush()
    for m in members:
        m.duplicate_group_id = group.id
    db.flush()
    return group


class TestJdGymsDirectoryStatusTransitions:
    def test_remove_request_archives_active_directory_and_updates_fields(self, db: Session):
        """Remove + active Directory → archive + field update (delete-from-directory path)."""
        now = datetime.now(timezone.utc)
        partner = _jd_partner(db)
        assert partner.name == "JD Gyms"

        active = _dir_row(
            db,
            partner_id=partner.id,
            first="Jordan",
            last="Blake",
            email="jordan.blake@jdgyms.co.uk",
            location="Birmingham",
            handled_at=now - timedelta(days=14),
            action="Add",
            outcome="Added",
            archived_at=None,
        )
        remove_req = _open_request(
            db,
            partner_id=partner.id,
            first="Jordan",
            last="Blake",
            email="jordan.blake@jdgyms.co.uk",
            location="Coventry",
            action="Remove",
            received_at=now,
        )
        group = _group(
            db,
            partner_id=partner.id,
            directory_id=active.id,
            members=[remove_req],
            classification="already_exists",
        )

        before_ledger = directory_ledger_rows(db, partner_id=partner.id, limit=50)
        assert any(r.id == active.id for r in before_ledger)

        resolve_group_delete_from_directory(
            db,
            group,
            active,
            final_values=schemas.PersonInfo(
                firstName="Jordan",
                lastName="Blake",
                email="jordan.blake@jdgyms.co.uk",
                location="Coventry",
            ),
            admin_id="dev-bypass",
            source_request_id=remove_req.id,
        )
        db.flush()
        db.refresh(active)

        assert active.id == group.directory_person_id
        assert active.person_location == "Coventry"
        assert active.outcome == "Removed"
        assert active.action == "Remove"
        assert active.archived_at is not None
        assert group.status == "resolved"

        after_ledger = directory_ledger_rows(db, partner_id=partner.id, limit=50)
        assert not any(r.id == active.id for r in after_ledger)
        archived = archived_snapshot_rows(db, partner_id=partner.id, limit=50)
        assert any(r.id == active.id for r in archived)
        assert db.query(models.ManagerRequest).filter_by(id=remove_req.id).first() is None

    def test_add_request_restores_archived_directory_and_updates_fields(self, db: Session):
        """Add + archived/Removed Directory → restore to active + field update."""
        now = datetime.now(timezone.utc)
        partner = _jd_partner(db)
        assert partner.name == "JD Gyms"

        archived = _dir_row(
            db,
            partner_id=partner.id,
            first="Casey",
            last="Nguyen",
            email="casey.nguyen@jdgyms.co.uk",
            location="Leeds",
            handled_at=now - timedelta(days=30),
            action="Remove",
            outcome="Removed",
            archived_at=now - timedelta(days=7),
            tags=[TAG_REMOVED],
        )
        add_req = _open_request(
            db,
            partner_id=partner.id,
            first="Casey",
            last="Nguyen",
            email="casey.nguyen@jdgyms.co.uk",
            location="Sheffield",
            action="Add",
            received_at=now,
        )
        group = _group(
            db,
            partner_id=partner.id,
            directory_id=archived.id,
            members=[add_req],
            classification="already_removed",
        )

        before_ledger = directory_ledger_rows(db, partner_id=partner.id, limit=50)
        assert not any(r.id == archived.id for r in before_ledger)

        updated = resolve_group_update(
            db,
            group,
            archived,
            final_values=schemas.PersonInfo(
                firstName="Casey",
                lastName="Nguyen",
                email="casey.nguyen@jdgyms.co.uk",
                location="Sheffield",
            ),
            admin_id="dev-bypass",
            source_request_id=add_req.id,
        )
        db.flush()
        db.refresh(archived)

        assert updated.id == archived.id
        assert archived.person_location == "Sheffield"
        assert archived.outcome == "Added"
        assert archived.action == "Add"
        assert archived.archived_at is None
        assert group.status == "resolved"

        after_ledger = directory_ledger_rows(db, partner_id=partner.id, limit=50)
        assert any(r.id == archived.id for r in after_ledger)
        history = get_lifecycle_history(archived)
        assert any(
            e.get("title") == "Restored to active" and e.get("outcome") == "Added"
            for e in history
        )
        assert db.query(models.ManagerRequest).filter_by(id=add_req.id).first() is None

    def test_add_request_restores_manually_archived_added_row(self, db: Session):
        """Add against a row that was only archived_at (outcome still Added) restores it."""
        now = datetime.now(timezone.utc)
        partner = _jd_partner(db)

        archived = _dir_row(
            db,
            partner_id=partner.id,
            first="Riley",
            last="Owen",
            email="riley.owen@jdgyms.co.uk",
            location="Liverpool",
            handled_at=now - timedelta(days=20),
            action="Add",
            outcome="Added",
            archived_at=now - timedelta(days=3),
        )
        add_req = _open_request(
            db,
            partner_id=partner.id,
            first="Riley",
            last="Owen",
            email="riley.owen@jdgyms.co.uk",
            location="Manchester",
            action="Add",
            received_at=now,
        )
        group = _group(
            db,
            partner_id=partner.id,
            directory_id=archived.id,
            members=[add_req],
        )

        resolve_group_update(
            db,
            group,
            archived,
            final_values=schemas.PersonInfo(
                firstName="Riley",
                lastName="Owen",
                email="riley.owen@jdgyms.co.uk",
                location="Manchester",
            ),
            admin_id="dev-bypass",
            source_request_id=add_req.id,
        )
        db.flush()
        db.refresh(archived)

        assert archived.archived_at is None
        assert archived.outcome == "Added"
        assert archived.person_location == "Manchester"
        assert any(r.id == archived.id for r in directory_ledger_rows(db, partner_id=partner.id, limit=50))

    def test_add_against_active_directory_stays_active(self, db: Session):
        """Add + active Directory still updates in place without status churn."""
        now = datetime.now(timezone.utc)
        partner = _jd_partner(db)
        active = _dir_row(
            db,
            partner_id=partner.id,
            first="Sam",
            last="Patel",
            email="sam.patel@jdgyms.co.uk",
            location="Nottingham",
            handled_at=now - timedelta(days=5),
        )
        add_req = _open_request(
            db,
            partner_id=partner.id,
            first="Sam",
            last="Patel",
            email="sam.patel@jdgyms.co.uk",
            location="Derby",
            action="Add",
            received_at=now,
        )
        group = _group(db, partner_id=partner.id, directory_id=active.id, members=[add_req])

        resolve_group_update(
            db,
            group,
            active,
            final_values=schemas.PersonInfo(
                firstName="Sam",
                lastName="Patel",
                email="sam.patel@jdgyms.co.uk",
                location="Derby",
            ),
            admin_id="dev-bypass",
            source_request_id=add_req.id,
        )
        db.flush()
        db.refresh(active)

        assert active.outcome == "Added"
        assert active.archived_at is None
        assert active.person_location == "Derby"
        history = get_lifecycle_history(active)
        assert any(e.get("title") == "Directory record updated" for e in history)
