"""Directory matching collapses stacked duplicates; keeps distinct update targets.

Repeated Add User / manual-entry can leave many identical handled Added rows
(same identity + same location). Those collapse to one representative.
Same-email rows with different locations stay separately selectable so the
admin radio step can choose which Directory record to update.
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
from app.duplicate_group_service import (
    find_all_directory_matches_for_requests,
    process_request_grouping,
)
from app.manager_request_intake import create_handled_manual_request

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


def _partner(db: Session, name: str = "JD Gyms") -> models.Partner:
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
    def test_same_person_duplicates_collapse_to_newest_representative(self, db: Session):
        """Same email (Directory same-person) → only the newest active row is matched."""
        now = datetime.now(timezone.utc)
        partner = _partner(db)

        older = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Max",
            email="carlmax@gmail.com",
            location="austin",
            handled_at=now - timedelta(days=10),
        )
        mid = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Max",
            email="carlmax@gmail.com",
            location="austin",
            handled_at=now - timedelta(days=5),
        )
        newest = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Max",
            email="carlmax@gmail.com",
            location="austin",
            handled_at=now - timedelta(days=1),
        )
        incoming = models.ManagerRequest(
            id=f"req-{uuid.uuid4().hex[:8]}",
            person_first_name="Carl",
            person_last_name="Max",
            person_email="carlmax@gmail.com",
            person_location="hogwarts",
            action="Add",
            status="new",
            received_at=now,
            partner_id=partner.id,
        )
        db.add_all([older, mid, newest, incoming])
        db.flush()

        group = process_request_grouping(db, incoming)
        db.flush()

        assert group is not None
        assert group.directory_person_id == newest.id
        stored_ids = (group.resolution_metadata or {}).get("matched_directory_person_ids") or []
        assert stored_ids == [newest.id]

        live = find_all_directory_matches_for_requests(db, [incoming])
        assert [r.id for r in live] == [newest.id]

    def test_same_email_different_locations_remain_selectable(self, db: Session):
        """Same email, different locations → both stay for the radio choose step."""
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
        # Primary uses stable oldest-first ranking; both remain selectable.
        assert group.directory_person_id in {older.id, newer.id}
        stored = (group.resolution_metadata or {}).get("matched_directory_person_ids") or []
        assert set(stored) == {older.id, newer.id}

        live = find_all_directory_matches_for_requests(db, [incoming])
        assert {r.id for r in live} == {older.id, newer.id}

    def test_collapse_keeps_distinct_identities(self, db: Session):
        """Rows that are not same_person are not collapsed together."""
        from app.duplicate_group_service import _collapse_directory_matches_to_representatives

        now = datetime.now(timezone.utc)
        partner = _partner(db)
        a = _dir_row(
            partner_id=partner.id,
            first="Alex",
            last="Rivera",
            email="alex.a@example.com",
            location="Austin",
            handled_at=now - timedelta(days=30),
        )
        b = _dir_row(
            partner_id=partner.id,
            first="Blake",
            last="Ng",
            email="blake.ng@example.com",
            location="Dallas",
            handled_at=now - timedelta(days=10),
        )
        db.add_all([a, b])
        db.flush()

        collapsed = _collapse_directory_matches_to_representatives(
            [(a, "potential_duplicate"), (b, "potential_duplicate")],
            is_ht=False,
            is_gll=False,
        )
        assert {p.id for p, _ in collapsed} == {a.id, b.id}

    def test_manager_search_and_match_show_every_row_without_collapse(self, db: Session):
        """Manager Directory search / match-candidates show stored rows as-is."""
        from app.directory_person_match import roster_match_candidates, search_roster_rows

        now = datetime.now(timezone.utc)
        partner = _partner(db)
        a = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Jonson",
            email="cj@gmail.com",
            location="Manchester",
            handled_at=now - timedelta(days=10),
        )
        b = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Jonson",
            email="cj@gmail.com",
            location="Alaska Country",
            handled_at=now - timedelta(hours=1),
        )
        c = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Jonson",
            email="cj@gmail.com",
            location="Alaska Country",
            handled_at=now - timedelta(hours=2),
        )
        removed_a = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Jonson",
            email="cj@gmail.com",
            location="England",
            handled_at=now - timedelta(days=3),
            action="Remove",
            outcome="Removed",
        )
        removed_a.archived_at = now - timedelta(days=2)
        removed_b = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Jonson",
            email="cj@gmail.com",
            location="England",
            handled_at=now - timedelta(days=4),
            action="Remove",
            outcome="Removed",
        )
        removed_b.archived_at = now - timedelta(days=3)
        db.add_all([a, b, c, removed_a, removed_b])
        db.flush()

        search_ids = {
            r.id for r in search_roster_rows(db, "cj@gmail.com", limit=25, partner_id=partner.id)
        }
        assert {a.id, b.id, c.id} <= search_ids
        assert removed_a.id not in search_ids

        removed_search_ids = {
            r.id
            for r in search_roster_rows(
                db,
                "cj@gmail.com",
                limit=25,
                partner_id=partner.id,
                outcome="Removed",
            )
        }
        assert {removed_a.id, removed_b.id} <= removed_search_ids
        assert a.id not in removed_search_ids

        match_ids = {
            r.id
            for r in roster_match_candidates(
                db,
                schemas.PersonInfo(
                    firstName="Carl",
                    lastName="Jonson",
                    email="cj@gmail.com",
                    location="Somewhere",
                ),
                limit=25,
                partner_id=partner.id,
            )
        }
        assert {a.id, b.id, c.id} <= match_ids

        removed_match_ids = {
            r.id
            for r in roster_match_candidates(
                db,
                schemas.PersonInfo(
                    firstName="Carl",
                    lastName="Jonson",
                    email="cj@gmail.com",
                    location="Somewhere",
                ),
                limit=25,
                partner_id=partner.id,
                outcome="Removed",
            )
        }
        assert {removed_a.id, removed_b.id} <= removed_match_ids

    def test_directory_lists_show_every_row_without_collapse(self, db: Session):
        """Active and Archived Directory show stored rows as-is (no identity collapse)."""
        from app.directory_person_match import archived_snapshot_rows, directory_ledger_rows

        now = datetime.now(timezone.utc)
        partner = _partner(db)
        manchester = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Jonson",
            email="cj@gmail.com",
            location="Manchester",
            handled_at=now - timedelta(days=10),
        )
        alaska = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Jonson",
            email="cj@gmail.com",
            location="Alaska Country",
            handled_at=now - timedelta(hours=1),
        )
        alaska_copy = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Jonson",
            email="cj@gmail.com",
            location="Alaska Country",
            handled_at=now - timedelta(hours=2),
        )
        archived_england = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Jonson",
            email="cj@gmail.com",
            location="England",
            handled_at=now - timedelta(days=5),
        )
        archived_england.archived_at = now - timedelta(days=1)
        archived_copy = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Jonson",
            email="cj@gmail.com",
            location="England",
            handled_at=now - timedelta(days=6),
            action="Remove",
            outcome="Removed",
        )
        archived_copy.archived_at = now - timedelta(days=2)
        db.add_all([manchester, alaska, alaska_copy, archived_england, archived_copy])
        db.flush()

        active_ids = {
            r.id
            for r in directory_ledger_rows(db, partner_id=partner.id, limit=50)
        }
        assert {manchester.id, alaska.id, alaska_copy.id} <= active_ids
        assert archived_england.id not in active_ids
        assert archived_copy.id not in active_ids

        archived_ids = {
            r.id
            for r in archived_snapshot_rows(db, partner_id=partner.id, limit=50)
        }
        assert {archived_england.id, archived_copy.id} <= archived_ids
        assert manchester.id not in archived_ids

    def test_collapse_keeps_same_email_different_locations(self, db: Session):
        """Stacked-copy collapse must not erase differently located update targets."""
        from app.duplicate_group_service import _collapse_directory_matches_to_representatives

        now = datetime.now(timezone.utc)
        partner = _partner(db)
        london = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Johnson",
            email="cj@therealgmail.com",
            location="London",
            handled_at=now - timedelta(days=10),
        )
        england = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Johnson",
            email="cj@therealgmail.com",
            location="England",
            handled_at=now - timedelta(days=1),
        )
        stacked = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Johnson",
            email="cj@therealgmail.com",
            location="England",
            handled_at=now - timedelta(days=2),
        )
        db.add_all([london, england, stacked])
        db.flush()

        collapsed = _collapse_directory_matches_to_representatives(
            [
                (london, "potential_duplicate"),
                (england, "potential_duplicate"),
                (stacked, "potential_duplicate"),
            ],
            is_ht=False,
            is_gll=False,
        )
        assert {p.id for p, _ in collapsed} == {london.id, england.id}

    def test_collapse_keeps_same_name_location_different_emails(self, db: Session):
        """Name+location same_person must not hide two differently emailed Directory rows."""
        from app.duplicate_group_service import (
            _collapse_directory_matches_to_representatives,
            _find_all_directory_matches,
        )
        from app.person_match import person_from_model

        now = datetime.now(timezone.utc)
        partner = _partner(db)
        a = _dir_row(
            partner_id=partner.id,
            first="Harry",
            last="Whitmore",
            email="harry.a@example.com",
            location="Witney",
            handled_at=now - timedelta(days=10),
        )
        b = _dir_row(
            partner_id=partner.id,
            first="Harry",
            last="Whitmore",
            email="harry.b@example.com",
            location="Witney",
            handled_at=now - timedelta(days=5),
        )
        db.add_all([a, b])
        db.flush()

        collapsed = _collapse_directory_matches_to_representatives(
            [(a, "potential_duplicate"), (b, "potential_duplicate")],
            is_ht=False,
            is_gll=False,
        )
        assert {p.id for p, _ in collapsed} == {a.id, b.id}

        incoming = schemas.PersonInfo(
            firstName="Harry",
            lastName="Whitmore",
            email="harry.new@example.com",
            location="Witney",
        )
        live = _find_all_directory_matches(
            db,
            incoming,
            [a, b],
            req_id="req-harry-new",
            is_ht=False,
            is_gll=False,
        )
        assert {p.id for p, _ in live} == {a.id, b.id}
        # person_from_model unused guard against import churn
        assert person_from_model(a).email == "harry.a@example.com"

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

    def test_manual_add_reuses_existing_active_directory_person(self, db: Session):
        now = datetime.now(timezone.utc)
        partner = _partner(db)
        existing = _dir_row(
            partner_id=partner.id,
            first="Carl",
            last="Max",
            email="carlmax@gmail.com",
            location="austin",
            handled_at=now - timedelta(days=2),
        )
        db.add(existing)
        db.flush()

        updated = create_handled_manual_request(
            db,
            person=schemas.PersonInfo(
                firstName="Carl",
                lastName="Max",
                email="carlmax@gmail.com",
                location="hogwarts",
            ),
            action="Add",
            partner_id=partner.id,
            admin_id="dev-bypass",
        )
        db.flush()
        db.refresh(existing)

        assert updated.id == existing.id
        assert existing.person_location == "hogwarts"
        assert existing.outcome == "Added"
        assert existing.archived_at is None
        count = (
            db.query(models.ManagerRequest)
            .filter(
                models.ManagerRequest.partner_id == partner.id,
                models.ManagerRequest.status == "handled",
                models.ManagerRequest.outcome == "Added",
                models.ManagerRequest.person_email == "carlmax@gmail.com",
            )
            .count()
        )
        assert count == 1
