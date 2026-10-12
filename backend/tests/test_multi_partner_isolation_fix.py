"""Regression tests for Multi-Partner Manager Isolation Fix.

Verifies:
1. Health Fitness registration associates manager with Health Fitness.
2. JD Gyms registration associates manager with JD Gyms.
3. Login resolves to correct user and partner (no crossover).
4. Partner-specific branding/form access resolves to manager partner.
5. Submission ownership is strictly scoped to the manager's partner.
6. Tampered partner identifier in payload/header is rejected with 403.
7. Ambiguous/missing partner context returns None/409, never silently falls back to JD Gyms.
8. Session and profile retrieval (/api/auth/me) persists and returns partner details.
9. Administrator access remains functional without regression.
"""

from __future__ import annotations

import uuid
import pytest
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api.auth import AuthenticatedUser, get_current_profile
from app.api.routers.pilot1 import _assert_manager_submitter, _manager_partner_id
from app.database import SessionLocal
from app.partner_allowlists import (
    assert_manager_email_allowed,
    create_manager_domain,
    create_partner,
    delete_partner,
    get_partner_by_slug,
    partner_slug_from_name,
    resolve_partner_for_manager_email,
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
def partner_setup(db: Session):
    """Create isolated test partners for Health Fitness and JD Gyms simulation."""
    suffix = uuid.uuid4().hex[:6]
    partner_hf = create_partner(db, f"Test Health Fitness {suffix}")
    partner_jd = create_partner(db, f"Test JD Gyms {suffix}")

    # Shared domain (e.g. gmail.com equivalent for tests)
    shared_domain = f"testdomain-{suffix}.com"
    create_manager_domain(db, shared_domain, partner_hf.id)
    create_manager_domain(db, shared_domain, partner_jd.id)

    db.commit()

    yield {
        "partner_hf": partner_hf,
        "partner_jd": partner_jd,
        "shared_domain": shared_domain,
        "hf_slug": partner_slug_from_name(partner_hf.name),
        "jd_slug": partner_slug_from_name(partner_jd.name),
    }

    # Cleanup test users and partners
    db.query(models.PowermusicUser).filter(
        models.PowermusicUser.email.like(f"%@{shared_domain}")
    ).delete(synchronize_session=False)
    db.commit()

    for pid in [partner_hf.id, partner_jd.id]:
        p = db.query(models.Partner).filter(models.Partner.id == pid).first()
        if p:
            try:
                delete_partner(db, pid)
            except Exception:
                db.rollback()


class TestMultiPartnerIsolation:

    def test_1_health_fitness_registration_and_association(self, db: Session, partner_setup):
        """Test 1: Health Fitness registration associates manager with Health Fitness."""
        hf = partner_setup["partner_hf"]
        hf_slug = partner_setup["hf_slug"]
        domain = partner_setup["shared_domain"]
        email = f"manager-hf@{domain}"

        # 1. Resolve partner during signup using slug
        resolved_pid = resolve_partner_for_manager_email(
            db, email, partner_slug=hf_slug
        )
        assert resolved_pid == hf.id

        # 2. Simulate manager user creation with partner_id
        manager_id = uuid.uuid4()
        mgr_user = models.PowermusicUser(
            id=manager_id,
            email=email,
            full_name="HF Manager",
            first_name="HF",
            last_name="Manager",
            club="Downtown Club",
            role="manager",
            partner_id=hf.id,
        )
        db.add(mgr_user)
        db.commit()

        # 3. Verify association persisted in database
        persisted = db.query(models.PowermusicUser).filter(models.PowermusicUser.id == manager_id).first()
        assert persisted is not None
        assert persisted.partner_id == hf.id
        assert persisted.role == "manager"

    def test_2_jd_gyms_registration_and_association(self, db: Session, partner_setup):
        """Test 2: JD Gyms registration associates manager with JD Gyms."""
        jd = partner_setup["partner_jd"]
        jd_slug = partner_setup["jd_slug"]
        domain = partner_setup["shared_domain"]
        email = f"manager-jd@{domain}"

        # 1. Resolve partner during signup using slug
        resolved_pid = resolve_partner_for_manager_email(
            db, email, partner_slug=jd_slug
        )
        assert resolved_pid == jd.id

        # 2. Simulate manager user creation with partner_id
        manager_id = uuid.uuid4()
        mgr_user = models.PowermusicUser(
            id=manager_id,
            email=email,
            full_name="JD Manager",
            first_name="JD",
            last_name="Manager",
            club="City Center",
            role="manager",
            partner_id=jd.id,
        )
        db.add(mgr_user)
        db.commit()

        # 3. Verify association persisted
        persisted = db.query(models.PowermusicUser).filter(models.PowermusicUser.id == manager_id).first()
        assert persisted is not None
        assert persisted.partner_id == jd.id

    def test_3_login_association_no_crossover(self, db: Session, partner_setup):
        """Test 3: Both managers authenticate and resolve to their respective partners."""
        hf = partner_setup["partner_hf"]
        jd = partner_setup["partner_jd"]
        domain = partner_setup["shared_domain"]

        # Create HF manager
        hf_mgr_id = uuid.uuid4()
        hf_mgr = models.PowermusicUser(
            id=hf_mgr_id,
            email=f"hf-user@{domain}",
            full_name="HF User",
            role="manager",
            partner_id=hf.id,
        )
        # Create JD manager
        jd_mgr_id = uuid.uuid4()
        jd_mgr = models.PowermusicUser(
            id=jd_mgr_id,
            email=f"jd-user@{domain}",
            full_name="JD User",
            role="manager",
            partner_id=jd.id,
        )
        db.add_all([hf_mgr, jd_mgr])
        db.commit()

        # Authenticated sessions
        auth_hf = AuthenticatedUser(
            id=str(hf_mgr.id),
            email=hf_mgr.email,
            role=hf_mgr.role,
            partner_id=hf_mgr.partner_id,
        )
        auth_jd = AuthenticatedUser(
            id=str(jd_mgr.id),
            email=jd_mgr.email,
            role=jd_mgr.role,
            partner_id=jd_mgr.partner_id,
        )

        assert auth_hf.partner_id == hf.id
        assert auth_jd.partner_id == jd.id
        assert auth_hf.partner_id != auth_jd.partner_id

        # Profile endpoint verification
        prof_hf = get_current_profile(user=auth_hf, db=db)
        prof_jd = get_current_profile(user=auth_jd, db=db)

        assert prof_hf["partner_id"] == hf.id
        assert prof_hf["partner_name"] == hf.name
        assert prof_jd["partner_id"] == jd.id
        assert prof_jd["partner_name"] == jd.name

    def test_4_partner_specific_form_access(self, db: Session, partner_setup):
        """Test 4: Branding endpoint resolves to manager's partner and rejects mismatched requests."""
        hf = partner_setup["partner_hf"]
        jd = partner_setup["partner_jd"]
        domain = partner_setup["shared_domain"]

        hf_mgr_id = uuid.uuid4()
        hf_mgr = models.PowermusicUser(
            id=hf_mgr_id,
            email=f"hf-branding@{domain}",
            role="manager",
            partner_id=hf.id,
        )
        db.add(hf_mgr)
        db.commit()

        # Without headers/params -> correctly resolves to manager's partner
        resolved = _manager_partner_id(
            db, hf_mgr.email, manager_user_id=str(hf_mgr.id)
        )
        assert resolved == hf.id

        # With mismatched partner_id header -> 403 Forbidden!
        with pytest.raises(HTTPException) as exc_info:
            _manager_partner_id(
                db,
                hf_mgr.email,
                partner_id=jd.id,
                manager_user_id=str(hf_mgr.id),
            )
        assert exc_info.value.status_code == 403

    def test_5_submission_ownership(self, db: Session, partner_setup):
        """Test 5: Valid requests are persisted under the manager's partner."""
        hf = partner_setup["partner_hf"]
        jd = partner_setup["partner_jd"]
        domain = partner_setup["shared_domain"]

        hf_mgr_id = uuid.uuid4()
        hf_mgr = models.PowermusicUser(
            id=hf_mgr_id,
            email=f"hf-sub@{domain}",
            role="manager",
            partner_id=hf.id,
        )
        jd_mgr_id = uuid.uuid4()
        jd_mgr = models.PowermusicUser(
            id=jd_mgr_id,
            email=f"jd-sub@{domain}",
            role="manager",
            partner_id=jd.id,
        )
        db.add_all([hf_mgr, jd_mgr])
        db.commit()

        # HF submitter check
        sub_hf = schemas.SubmittedBy(email=hf_mgr.email, firstName="HF", lastName="Sub")
        auth_hf = AuthenticatedUser(id=str(hf_mgr.id), email=hf_mgr.email, role="manager", partner_id=hf.id)
        pid_hf = _assert_manager_submitter(sub_hf, auth_hf, db)
        assert pid_hf == hf.id

        # JD submitter check
        sub_jd = schemas.SubmittedBy(email=jd_mgr.email, firstName="JD", lastName="Sub")
        auth_jd = AuthenticatedUser(id=str(jd_mgr.id), email=jd_mgr.email, role="manager", partner_id=jd.id)
        pid_jd = _assert_manager_submitter(sub_jd, auth_jd, db)
        assert pid_jd == jd.id

    def test_6_tampered_partner_identifier_rejected(self, db: Session, partner_setup):
        """Test 6: Authenticated HF manager cannot submit under JD Gyms partner identifier."""
        hf = partner_setup["partner_hf"]
        jd = partner_setup["partner_jd"]
        domain = partner_setup["shared_domain"]

        hf_mgr_id = uuid.uuid4()
        hf_mgr = models.PowermusicUser(
            id=hf_mgr_id,
            email=f"hf-tamper@{domain}",
            role="manager",
            partner_id=hf.id,
        )
        db.add(hf_mgr)
        db.commit()

        auth_hf = AuthenticatedUser(id=str(hf_mgr.id), email=hf_mgr.email, role="manager", partner_id=hf.id)
        sub = schemas.SubmittedBy(email=hf_mgr.email, firstName="HF", lastName="Tamper")

        # Attempt to submit with JD partner_id in payload
        with pytest.raises(HTTPException) as exc_info:
            _assert_manager_submitter(
                sub,
                auth_hf,
                db,
                partner_id=jd.id,
            )
        assert exc_info.value.status_code == 403
        assert "not authorized" in exc_info.value.detail.lower()

        # Attempt to submit with JD partner header
        with pytest.raises(HTTPException) as exc_info2:
            _assert_manager_submitter(
                sub,
                auth_hf,
                db,
                header_partner_id=jd.id,
            )
        assert exc_info2.value.status_code == 403

        # Attempt to submit with JD slug header
        with pytest.raises(HTTPException) as exc_info3:
            _assert_manager_submitter(
                sub,
                auth_hf,
                db,
                header_partner_slug=partner_setup["jd_slug"],
            )
        assert exc_info3.value.status_code == 403

    def test_7_invalid_or_missing_partner_context_no_silent_fallback(self, db: Session, partner_setup):
        """Test 7: Shared domain without partner context returns None, never silently picking a partner."""
        domain = partner_setup["shared_domain"]
        email = f"unassociated@{domain}"

        # 1. Missing partner context on shared domain
        resolved = resolve_partner_for_manager_email(db, email)
        assert resolved is None, "Must not silently fall back to JD Gyms or any partner!"

        # 2. Invalid partner slug
        resolved_invalid = resolve_partner_for_manager_email(
            db, email, partner_slug="non-existent-partner"
        )
        assert resolved_invalid is None

        # 3. With raise_if_ambiguous flag
        with pytest.raises(HTTPException) as exc_info:
            resolve_partner_for_manager_email(db, email, raise_if_ambiguous=True)
        assert exc_info.value.status_code == 409

    def test_8_session_persistence_and_profile_retrieval(self, db: Session, partner_setup):
        """Test 8: Authenticated manager profile maintains partner across calls."""
        hf = partner_setup["partner_hf"]
        domain = partner_setup["shared_domain"]

        mgr_id = uuid.uuid4()
        mgr = models.PowermusicUser(
            id=mgr_id,
            email=f"hf-persist@{domain}",
            full_name="Persistent Manager",
            club="North Club",
            role="manager",
            partner_id=hf.id,
        )
        db.add(mgr)
        db.commit()

        user = AuthenticatedUser(
            id=str(mgr.id),
            email=mgr.email,
            role="manager",
            partner_id=mgr.partner_id,
        )

        profile_1 = get_current_profile(user=user, db=db)
        profile_2 = get_current_profile(user=user, db=db)

        assert profile_1["partner_id"] == hf.id
        assert profile_1["partner_name"] == hf.name
        assert profile_1["partner_slug"] == partner_setup["hf_slug"]
        assert profile_1 == profile_2

    def test_9_existing_admin_and_other_partners_unaffected(self, db: Session, partner_setup):
        """Test 9: Admin profile remains functional with partner_id=None."""
        admin_user = (
            db.query(models.PowermusicUser)
            .filter(models.PowermusicUser.role == "admin")
            .first()
        )
        if not admin_user:
            admin_user = models.PowermusicUser(
                id=uuid.uuid4(),
                email="admin-test@powermusic.com",
                full_name="Power Music Admin",
                role="admin",
                partner_id=None,
            )
            db.add(admin_user)
            db.commit()

        auth_admin = AuthenticatedUser(
            id=str(admin_user.id),
            email=admin_user.email,
            role="admin",
            partner_id=None,
        )

        profile = get_current_profile(user=auth_admin, db=db)
        assert profile["role"] == "admin"
        assert profile["partner_id"] is None
        assert profile["partner_name"] is None
