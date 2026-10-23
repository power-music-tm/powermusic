"""JD Gyms only: Add/Remove request × active/archived Directory status transitions.

Covers:
1. Remove request + active Directory → archive + update (via delete-from-directory UI path).
2. Add request + archived/Removed Directory → new active Directory record; archive unchanged.
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
    _sync_group_representative_and_tags,
    compute_group_classification_summary,
    eligible_directory_person_ids_for_group,
    find_all_directory_matches_for_requests,
    process_request_grouping,
    resolve_group_add,
    resolve_group_delete_from_directory,
    resolve_group_update,
)
from app.intake_persons import get_lifecycle_history
from app.manager_request_serialize import directory_person_to_api_dict
from app.manager_request_tags import TAG_ALREADY_REMOVED, TAG_REMOVED


def _tags_blob(req: models.ManagerRequest) -> str:
    """SQLite JSON adapters can flatten list tags; compare via a normalized blob."""
    raw = req.tags
    if raw is None:
        return ""
    if isinstance(raw, list):
        # Character-list artifact after double JSON encode on SQLite.
        if raw and all(isinstance(t, str) and len(t) <= 1 for t in raw):
            return "".join(raw).lower()
        return " ".join(str(t) for t in raw).lower()
    return str(raw).lower()

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

    def test_add_request_against_archived_creates_new_active_record(self, db: Session):
        """Add + archived/Removed Directory → new active record; archive unchanged."""
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

        assert eligible_directory_person_ids_for_group(db, group) == set()
        before_ledger = directory_ledger_rows(db, partner_id=partner.id, limit=50)
        assert not any(r.id == archived.id for r in before_ledger)
        before_loc = archived.person_location
        before_hist = list(get_lifecycle_history(archived))

        with pytest.raises(ValueError, match="Archived"):
            resolve_group_update(
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

        created = resolve_group_add(
            db,
            group,
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

        assert created.id != archived.id
        assert created.outcome == "Added"
        assert created.archived_at is None
        assert created.person_location == "Sheffield"
        assert archived.person_location == before_loc
        assert archived.outcome == "Removed"
        assert archived.archived_at is not None
        assert get_lifecycle_history(archived) == before_hist
        assert group.status == "resolved"

        after_ledger = directory_ledger_rows(db, partner_id=partner.id, limit=50)
        assert any(r.id == created.id for r in after_ledger)
        assert not any(r.id == archived.id for r in after_ledger)

    def test_add_request_against_manually_archived_creates_new_active_record(self, db: Session):
        """Add against archived_at-only row (outcome still Added) creates a new active record."""
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

        assert eligible_directory_person_ids_for_group(db, group) == set()
        before_arch = archived.archived_at

        created = resolve_group_add(
            db,
            group,
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

        assert created.id != archived.id
        assert created.person_location == "Manchester"
        assert created.archived_at is None
        assert archived.archived_at is not None
        assert archived.archived_at.replace(tzinfo=None) == before_arch.replace(tzinfo=None)
        assert archived.person_location == "Liverpool"
        assert any(r.id == created.id for r in directory_ledger_rows(db, partner_id=partner.id, limit=50))
        assert not any(r.id == archived.id for r in directory_ledger_rows(db, partner_id=partner.id, limit=50))

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

    def test_add_against_archived_links_directory_and_tags_already_removed(self, db: Session):
        """Add vs archived Directory must link the archived row and surface Already Removed (+ potential)."""
        now = datetime.now(timezone.utc)
        partner = _jd_partner(db)

        archived = _dir_row(
            db,
            partner_id=partner.id,
            first="Taylor",
            last="Brooks",
            email="taylor.brooks@jdgyms.co.uk",
            location="Bristol",
            handled_at=now - timedelta(days=40),
            action="Remove",
            outcome="Removed",
            archived_at=now - timedelta(days=10),
            tags=[TAG_REMOVED],
        )
        # Potential-style mismatch on location so classification can be potential_duplicate.
        add_req = _open_request(
            db,
            partner_id=partner.id,
            first="Taylor",
            last="Brooks",
            email="taylor.brooks@jdgyms.co.uk",
            location="Bath",
            action="Add",
            received_at=now,
        )
        db.flush()

        group = process_request_grouping(db, add_req)
        db.flush()
        assert group is not None
        assert group.directory_person_id == archived.id

        live = find_all_directory_matches_for_requests(db, [add_req])
        assert any(r.id == archived.id for r in live)

        _sync_group_representative_and_tags(db, group, member_requests=[add_req])
        db.flush()
        db.refresh(add_req)
        blob = _tags_blob(add_req)
        assert TAG_ALREADY_REMOVED in blob

        summary = compute_group_classification_summary(db, group, members=[add_req])
        assert summary["alreadyRemoved"] is True
        assert summary["alreadyExists"] is False

        api_person = directory_person_to_api_dict(archived, db=db)
        assert api_person.get("archivedAt") is not None
        assert api_person.get("status") == "Removed"

    def test_add_against_manually_archived_added_row_treated_as_off_roster(self, db: Session):
        """Manual archive (archived_at set, outcome still Added) must not look like active Exists."""
        now = datetime.now(timezone.utc)
        partner = _jd_partner(db)

        archived = _dir_row(
            db,
            partner_id=partner.id,
            first="Morgan",
            last="Reed",
            email="morgan.reed@jdgyms.co.uk",
            location="Hull",
            handled_at=now - timedelta(days=12),
            action="Add",
            outcome="Added",
            archived_at=now - timedelta(days=2),
        )
        add_req = _open_request(
            db,
            partner_id=partner.id,
            first="Morgan",
            last="Reed",
            email="morgan.reed@jdgyms.co.uk",
            location="Hull",
            action="Add",
            received_at=now,
        )
        db.flush()

        group = process_request_grouping(db, add_req)
        db.flush()
        assert group is not None
        assert group.directory_person_id == archived.id
        # Confirmed match against off-roster → already_removed, not already_exists.
        assert group.classification in ("already_removed", "potential_duplicate")

        _sync_group_representative_and_tags(db, group, member_requests=[add_req])
        db.flush()
        db.refresh(add_req)
        assert TAG_ALREADY_REMOVED in _tags_blob(add_req)
        summary = compute_group_classification_summary(db, group, members=[add_req])
        assert summary["alreadyRemoved"] is True
