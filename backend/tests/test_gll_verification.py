"""
GLL Partner Implementation — End-to-End Verification Suite
===========================================================
Covers all 14 verification points from the GLL End-to-End task.
Uses SQLite in-memory database for full isolated verification.
"""

from __future__ import annotations
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import ARRAY
from sqlalchemy.dialects.postgresql import JSONB

from app import models, schemas
from app.duplicate_matching import (
    GLL_POTENTIAL_DUPLICATE_THRESHOLD,
    POTENTIAL_DUPLICATE_THRESHOLD,
    match_classification,
    match_classification_gll,
    match_classification_for_partner,
    is_gll_partner,
    is_healthtech_partner,
)
from app.person_match import same_person_gll, same_person_for_partner, same_person
from app.directory_person_match import (
    duplicate_tags_for_person,
    find_directory_conflict,
    directory_outcome_conflicts,
)
from app.manager_request_tags import TAG_ALREADY_EXISTS, TAG_ALREADY_REMOVED

# Register sqlite adapters for JSON/ARRAY columns
sqlite3.register_adapter(list, json.dumps)
sqlite3.register_adapter(dict, json.dumps)


# ─── SQLite In-Memory DB Fixture ──────────────────────────────────────────────

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


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _p(first="John", last="Smith", email=None, location=None):
    return schemas.PersonInfo(
        firstName=first,
        lastName=last,
        email=email or f"gll-{uuid.uuid4().hex[:8]}@example.com",
        location=location,
    )


def _handled_row(db, person, *, outcome, action, partner_id=None):
    row = models.ManagerRequest(
        id=f"test-{uuid.uuid4().hex[:8]}",
        received_at=datetime.now(timezone.utc),
        handled_at=datetime.now(timezone.utc),
        person_first_name=person.firstName,
        person_last_name=person.lastName,
        person_email=person.email,
        person_location=person.location or "",
        action=action,
        tags=[],
        status="handled",
        outcome=outcome,
        partner_id=partner_id,
    )
    db.add(row)
    db.flush()
    return row


def _mock_db_for_partner(partner_name: str):
    partner = MagicMock()
    partner.name = partner_name
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = partner
    return db


def _gll_partner(db):
    from app.partner_allowlists import create_partner
    p = create_partner(db, f"GLL Verification {uuid.uuid4().hex[:4]}")
    db.flush()
    return p


def _puregym_partner(db):
    from app.partner_allowlists import create_partner
    p = create_partner(db, f"PureGym Verification {uuid.uuid4().hex[:4]}")
    db.flush()
    return p


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 1: GLL Confirmed Duplicate
# ══════════════════════════════════════════════════════════════════════════════

class TestGllConfirmedDuplicate:
    def test_exact_match_returns_confirmed(self):
        label, score = match_classification_gll(
            _p("John", "Smith", "john@example.com"),
            _p("John", "Smith", "john@example.com"),
        )
        assert label == "confirmed_duplicate", f"Got {label}"

    def test_exact_match_score_is_75(self):
        _, score = match_classification_gll(
            _p("John", "Smith", "john@example.com"),
            _p("John", "Smith", "john@example.com"),
        )
        assert score == 75.0, f"Expected 75.0, got {score}"

    def test_null_location_does_not_prevent_confirmed(self):
        label, score = match_classification_gll(
            _p("Jane", "Doe", "jane@example.com", location=None),
            _p("Jane", "Doe", "jane@example.com", location=None),
        )
        assert label == "confirmed_duplicate"
        assert score == 75.0

    def test_partner_router_gll_branch(self):
        label, score = match_classification_for_partner(
            _p("John", "Smith", "john@example.com"),
            _p("John", "Smith", "john@example.com"),
            is_gll=True,
        )
        assert label == "confirmed_duplicate"
        assert score == 75.0


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 2: GLL Potential Duplicate
# ══════════════════════════════════════════════════════════════════════════════

class TestGllPotentialDuplicate:
    def test_similar_names_above_threshold(self):
        label, score = match_classification_gll(
            _p("Jonathan", "Smith", "a@example.com"),
            _p("John",     "Smith", "b@example.com"),
        )
        assert score >= GLL_POTENTIAL_DUPLICATE_THRESHOLD, f"Score {score:.2f} below threshold"
        assert label == "potential_duplicate"

    def test_jaro_winkler_prefix_bonus(self):
        _, score_similar = match_classification_gll(
            _p("Jon",   "Taylor", "x@x.com"),
            _p("John",  "Taylor", "y@y.com"),
        )
        _, score_other = match_classification_gll(
            _p("Alice", "Taylor", "a@a.com"),
            _p("John",  "Taylor", "y@y.com"),
        )
        assert score_similar > score_other, (
            f"JW prefix bonus not detected: similar={score_similar:.2f} other={score_other:.2f}"
        )

    def test_threshold_constant(self):
        assert GLL_POTENTIAL_DUPLICATE_THRESHOLD == 33.75


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 3: Below-Threshold
# ══════════════════════════════════════════════════════════════════════════════

class TestGllBelowThreshold:
    def test_unrelated_no_match(self):
        label, score = match_classification_gll(
            _p("Alice", "Jones",  "a@example.com"),
            _p("Bob",   "Brown",  "z@example.com"),
        )
        assert label is None, f"Expected None, got {label} (score={score:.2f})"
        assert score < GLL_POTENTIAL_DUPLICATE_THRESHOLD


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 4: Already Exists (DB test)
# ══════════════════════════════════════════════════════════════════════════════

class TestGllAlreadyExists:
    def test_add_against_active_gets_tag(self, db: Session):
        email = f"gll-ae-{uuid.uuid4().hex[:8]}@example.com"
        person = _p("Sara", "Malik", email, location=None)
        gll = _gll_partner(db)
        _handled_row(db, person, outcome="Added", action="Add", partner_id=str(gll.id))
        tags = duplicate_tags_for_person(db, person, action="Add", partner_id=str(gll.id))
        assert TAG_ALREADY_EXISTS in tags, f"Got: {tags}"

    def test_outcome_conflict_logic_add_vs_added(self):
        assert directory_outcome_conflicts("Add", "Added") is True

    def test_outcome_conflict_add_vs_removed_no_conflict(self):
        assert directory_outcome_conflicts("Add", "Removed") is False


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 5: Already Removed (DB test)
# ══════════════════════════════════════════════════════════════════════════════

class TestGllAlreadyRemoved:
    def test_remove_against_archived_gets_tag(self, db: Session):
        email = f"gll-ar-{uuid.uuid4().hex[:8]}@example.com"
        person = _p("Ben", "Clark", email, location=None)
        gll = _gll_partner(db)
        _handled_row(db, person, outcome="Removed", action="Remove", partner_id=str(gll.id))
        tags = duplicate_tags_for_person(db, person, action="Remove", partner_id=str(gll.id))
        assert TAG_ALREADY_REMOVED in tags, f"Got: {tags}"

    def test_outcome_conflict_remove_vs_removed(self):
        assert directory_outcome_conflicts("Remove", "Removed") is True

    def test_outcome_conflict_remove_vs_added_no_conflict(self):
        assert directory_outcome_conflicts("Remove", "Added") is False


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 6: Active + Remove (valid removal) — DB test
# ══════════════════════════════════════════════════════════════════════════════

class TestGllValidRemoval:
    def test_remove_against_active_not_already_removed(self, db: Session):
        email = f"gll-ra-{uuid.uuid4().hex[:8]}@example.com"
        person = _p("Chris", "Evans", email, location=None)
        gll = _gll_partner(db)
        _handled_row(db, person, outcome="Added", action="Add", partner_id=str(gll.id))
        tags = duplicate_tags_for_person(db, person, action="Remove", partner_id=str(gll.id))
        assert TAG_ALREADY_REMOVED not in tags, f"Got: {tags}"


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 7: Archived + Add (valid re-hire) — DB test
# ══════════════════════════════════════════════════════════════════════════════

class TestGllValidRehire:
    def test_add_against_archived_not_already_exists(self, db: Session):
        email = f"gll-aa-{uuid.uuid4().hex[:8]}@example.com"
        person = _p("Diana", "Prince", email, location=None)
        gll = _gll_partner(db)
        _handled_row(db, person, outcome="Removed", action="Remove", partner_id=str(gll.id))
        tags = duplicate_tags_for_person(db, person, action="Add", partner_id=str(gll.id))
        assert TAG_ALREADY_EXISTS not in tags, f"Got: {tags}"


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 8: Location Independence
# ══════════════════════════════════════════════════════════════════════════════

class TestGllLocationIndependence:
    def test_null_location_records_still_match(self):
        label, _ = match_classification_gll(
            _p("Tom", "Hardy", "tom@example.com", location=None),
            _p("Tom", "Hardy", "tom@example.com", location=None),
        )
        assert label == "confirmed_duplicate"

    def test_score_is_location_invariant(self):
        email = f"loc-inv-{uuid.uuid4().hex[:8]}@example.com"
        ref = _p("Tom", "Hardy", email, location=None)
        _, s_loc  = match_classification_gll(_p("Tom", "Hardy", email, location="London"), ref)
        _, s_none = match_classification_gll(_p("Tom", "Hardy", email, location=None),   ref)
        assert s_loc == s_none, f"loc={s_loc} none={s_none}"

    def test_directory_tags_work_with_null_location(self, db: Session):
        email = f"gll-null-{uuid.uuid4().hex[:8]}@example.com"
        person = _p("Tom", "Hardy", email, location=None)
        gll = _gll_partner(db)
        _handled_row(db, person, outcome="Added", action="Add", partner_id=str(gll.id))
        tags = duplicate_tags_for_person(db, person, action="Add", partner_id=str(gll.id))
        assert TAG_ALREADY_EXISTS in tags


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 9: Cross-Partner Isolation — DB tests
# ══════════════════════════════════════════════════════════════════════════════

class TestCrossPartnerIsolation:
    def test_gll_does_not_match_puregym_record(self, db: Session):
        email = f"iso-{uuid.uuid4().hex[:8]}@example.com"
        person = _p("Identical", "Name", email)
        gll = _gll_partner(db)
        pg  = _puregym_partner(db)
        _handled_row(db, person, outcome="Added", action="Add", partner_id=str(pg.id))
        tags = duplicate_tags_for_person(db, person, action="Add", partner_id=str(gll.id))
        assert TAG_ALREADY_EXISTS not in tags, "GLL matched PureGym record — isolation broken"

    def test_puregym_does_not_match_gll_record(self, db: Session):
        email = f"iso-pg-{uuid.uuid4().hex[:8]}@example.com"
        person = _p("Identical", "Name", email, location="London")
        gll = _gll_partner(db)
        pg  = _puregym_partner(db)
        _handled_row(db, person, outcome="Added", action="Add", partner_id=str(gll.id))
        tags = duplicate_tags_for_person(db, person, action="Add", partner_id=str(pg.id))
        assert TAG_ALREADY_EXISTS not in tags, "PureGym matched GLL record — isolation broken"


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 10: PureGym Regression
# ══════════════════════════════════════════════════════════════════════════════

class TestPureGymRegression:
    def test_confirmed_uses_100_point_scale(self):
        p = schemas.PersonInfo(firstName="Jane", lastName="Doe", email="j@pg.com", location="London")
        label, score = match_classification(p, p)
        assert label == "confirmed_duplicate"
        assert score == 100.0, f"Got {score}"

    def test_threshold_unchanged(self):
        assert POTENTIAL_DUPLICATE_THRESHOLD == 45.0

    def test_location_affects_puregym_score(self):
        p1 = schemas.PersonInfo(firstName="Jane", lastName="Doe", email="j@pg.com", location="London")
        p2 = schemas.PersonInfo(firstName="Jane", lastName="Doe", email="j@pg.com", location="Manchester")
        _, s_mismatch = match_classification(p1, p2)
        _, s_match    = match_classification(p1, p1)
        assert s_mismatch < s_match, "Location mismatch must lower PureGym score"

    def test_partner_router_non_gll_uses_4_field(self):
        p = schemas.PersonInfo(firstName="Jane", lastName="Doe", email="j@pg.com", location="London")
        label, score = match_classification_for_partner(p, p, is_gll=False, is_healthtech=False)
        assert label == "confirmed_duplicate"
        assert score == 100.0


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 11: Health Fitness Regression
# ══════════════════════════════════════════════════════════════════════════════

class TestHealthFitnessRegression:
    def test_healthtech_detection_via_mock_db(self):
        for name in ("Health Fitness Ltd", "HealthTech Corp", "health fitness uk"):
            db = _mock_db_for_partner(name)
            assert is_healthtech_partner(db, "partner-hf"), f"Should detect HF: {name}"

        for name in ("GLL Sports", "PureGym UK"):
            db = _mock_db_for_partner(name)
            assert not is_healthtech_partner(db, "partner-x"), f"Should NOT detect HF: {name}"

    def test_gll_detection_via_mock_db(self):
        for name in ("GLL", "GLL Sports Foundation", "gll leisure"):
            db = _mock_db_for_partner(name)
            assert is_gll_partner(db, "partner-gll"), f"Should detect GLL: {name}"

        for name in ("Health Fitness", "PureGym", "Pure Gym"):
            db = _mock_db_for_partner(name)
            assert not is_gll_partner(db, "partner-x"), f"Should NOT detect GLL: {name}"


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 12: GLL Signup Terms (no location field)
# ══════════════════════════════════════════════════════════════════════════════

class TestGllSignupTerms:
    def test_gll_name_detected(self):
        db = _mock_db_for_partner("GLL")
        assert is_gll_partner(db, "gll-partner-id") is True

    def test_puregym_not_detected_as_gll(self):
        db = _mock_db_for_partner("PureGym UK")
        assert not is_gll_partner(db, "pg-partner-id")

    def test_health_fitness_not_detected_as_gll(self):
        db = _mock_db_for_partner("Health Fitness")
        assert not is_gll_partner(db, "hf-partner-id")

    def test_gll_schema_accepts_no_location(self):
        p = schemas.PersonInfo(
            firstName="Manager", lastName="Test",
            email="mgr@gll.com", location=None
        )
        assert p.location is None


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 13: GLL Admin UI — score max and location invariance
# ══════════════════════════════════════════════════════════════════════════════

class TestGllAdminUI:
    def test_score_max_is_75(self):
        p = _p("Alan", "Bole", "c@d.com")
        _, score = match_classification_gll(p, p)
        assert score == 75.0

    def test_gll_matching_ignores_location_weight(self):
        email = "admin-ui@example.com"
        p_with = _p("Test", "User", email, location="London")
        p_none = _p("Test", "User", email, location=None)
        ref    = _p("Test", "User", email, location=None)
        _, s1 = match_classification_gll(p_with, ref)
        _, s2 = match_classification_gll(p_none, ref)
        assert s1 == s2, f"with_loc={s1} none={s2}"


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 14: Same-Person GLL Helper
# ══════════════════════════════════════════════════════════════════════════════

class TestSamePersonGll:
    def test_exact_email_match(self):
        p1 = _p("John", "Smith", "john@example.com")
        p2 = _p("John", "Smith", "john@example.com")
        assert same_person_gll(p1, p2) is True

    def test_email_only_match(self):
        p1 = _p("John",  "Smith", "john@example.com")
        p2 = _p("Janet", "Brown", "john@example.com")
        assert same_person_gll(p1, p2) is True

    def test_different_email_not_same_person(self):
        p1 = _p("John", "Smith", "john@example.com")
        p2 = _p("John", "Smith", "jane@example.com")
        assert same_person_gll(p1, p2) is False

    def test_partner_router_gll_true(self):
        p1 = _p("John", "Smith", "john@example.com")
        p2 = _p("John", "Smith", "john@example.com")
        assert same_person_for_partner(p1, p2, is_gll=True) is True

    def test_partner_router_non_gll_uses_4field(self):
        p1 = schemas.PersonInfo(firstName="John", lastName="Smith", email="j@x.com", location="London")
        p2 = schemas.PersonInfo(firstName="John", lastName="Smith", email="j@x.com", location="London")
        assert same_person(p1, p2) is True


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK 15: Already Removed Directory Record Resolution Test
# ══════════════════════════════════════════════════════════════════════════════

class TestAlreadyRemovedDirectoryRecordResolution:
    def test_get_duplicate_group_details_includes_directory_person(self, db: Session):
        from app.duplicate_group_service import process_request_grouping
        from app.api.routers.pilot1 import get_duplicate_group_details
        from app.manager_request_intake import intake_manager_submission

        gll = _gll_partner(db)
        email = f"ar-res-{uuid.uuid4().hex[:8]}@example.com"
        person = _p("Henry", "Ford", email, location=None)

        # 1. Create an archived/removed handled directory row
        archived_row = _handled_row(db, person, outcome="Removed", action="Remove", partner_id=str(gll.id))

        # 2. Create a new Remove request
        req = intake_manager_submission(
            db,
            person=person,
            action="Remove",
            partner_id=str(gll.id),
            new_id=f"test-req-{uuid.uuid4().hex[:8]}",
        )
        db.flush()

        group = process_request_grouping(db, req)
        assert group is not None
        assert group.directory_person_id == archived_row.id
        assert group.classification == "already_removed"

        db.flush()

        # 3. Fetch details via endpoint logic
        out = get_duplicate_group_details(group.id, db=db, _admin=None)
        assert out["directoryPerson"] is not None
        assert out["directoryPerson"]["firstName"] == "Henry"
        assert out["directoryPerson"]["lastName"] == "Ford"
        assert out["directoryPerson"]["email"] == email
        assert out["directoryPerson"]["status"] == "Removed"


class TestGllManagerLocation:
    def test_manager_user_fields_extracts_club_as_location(self):
        from app.models import PowermusicUser
        from app.user_display import user_manager_fields

        user = PowermusicUser(
            id=uuid.uuid4(),
            email="gll.manager@example.com",
            first_name="Jane",
            last_name="Doe",
            club="London Central",
            role="manager"
        )
        fields = user_manager_fields(user)
        assert fields["firstName"] == "Jane"
        assert fields["lastName"] == "Doe"
        assert fields["email"] == "gll.manager@example.com"
        assert fields["club"] == "London Central"

    def test_manager_user_fields_handles_null_club(self):
        from app.models import PowermusicUser
        from app.user_display import user_manager_fields

        user = PowermusicUser(
            id=uuid.uuid4(),
            email="gll.manager2@example.com",
            first_name="John",
            last_name="Smith",
            club=None,
            role="manager"
        )
        fields = user_manager_fields(user)
        assert fields["club"] == ""


