"""Tests for multi-partner scoped domain and automated source support."""

from __future__ import annotations

import uuid
import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal
from app.partner_allowlists import (
    assert_manager_email_allowed,
    create_automated_source,
    create_manager_domain,
    create_partner,
    delete_manager_domain,
    delete_partner,
    list_manager_domain_strings,
    list_manager_domains,
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
def test_partners(db: Session):
    suffix = uuid.uuid4().hex[:6]
    partner_a = create_partner(db, f"Partner Scoped A {suffix}")
    partner_b = create_partner(db, f"Partner Scoped B {suffix}")
    db.commit()

    yield partner_a, partner_b

    # Cleanup
    for pid in [partner_a.id, partner_b.id]:
        p = db.query(models.Partner).filter(models.Partner.id == pid).first()
        if p:
            try:
                delete_partner(db, pid)
            except Exception:
                db.rollback()


class TestPartnerDomainScoping:
    def test_shared_domain_allowed_across_different_partners(self, db: Session, test_partners):
        partner_a, partner_b = test_partners
        shared_domain = f"test-{uuid.uuid4().hex[:6]}.com"

        # 1. Add domain to Partner A
        dom_a = create_manager_domain(db, shared_domain, partner_a.id)
        assert dom_a.partner_id == partner_a.id
        assert dom_a.domain == shared_domain

        # 2. Add same domain to Partner B - must succeed without 409
        dom_b = create_manager_domain(db, shared_domain, partner_b.id)
        assert dom_b.partner_id == partner_b.id
        assert dom_b.domain == shared_domain

        # 3. Add same domain to Partner A again - must fail with 409
        with pytest.raises(HTTPException) as exc_info:
            create_manager_domain(db, shared_domain, partner_a.id)
        assert exc_info.value.status_code == 409
        assert "already allowed for this partner" in str(exc_info.value.detail)

    def test_domain_listing_and_deduplication(self, db: Session, test_partners):
        partner_a, partner_b = test_partners
        shared_domain = f"dedup-{uuid.uuid4().hex[:6]}.com"

        create_manager_domain(db, shared_domain, partner_a.id)
        create_manager_domain(db, shared_domain, partner_b.id)

        # Scoped lists
        domains_a = list_manager_domain_strings(db, partner_id=partner_a.id)
        domains_b = list_manager_domain_strings(db, partner_id=partner_b.id)
        assert shared_domain in domains_a
        assert shared_domain in domains_b

        # Global list should have no duplicate items
        all_domains = list_manager_domain_strings(db)
        assert all_domains.count(shared_domain) == 1

    def test_resolve_partner_for_manager_email_scoped(self, db: Session, test_partners):
        partner_a, partner_b = test_partners
        shared_domain = f"resolve-{uuid.uuid4().hex[:6]}.com"
        unique_domain = f"unique-{uuid.uuid4().hex[:6]}.com"

        create_manager_domain(db, shared_domain, partner_a.id)
        create_manager_domain(db, shared_domain, partner_b.id)
        create_manager_domain(db, unique_domain, partner_a.id)

        email = f"manager@{shared_domain}"
        unique_email = f"manager@{unique_domain}"

        # With partner context
        assert resolve_partner_for_manager_email(db, email, partner_id=partner_a.id) == partner_a.id
        assert resolve_partner_for_manager_email(db, email, partner_id=partner_b.id) == partner_b.id
        assert resolve_partner_for_manager_email(db, email, partner_id="nonexistent-partner") is None

        # Unique domain resolves without explicit partner_id
        assert resolve_partner_for_manager_email(db, unique_email) == partner_a.id

        # Shared domain without partner context raises 409 (ambiguous) when raise_if_ambiguous=True
        with pytest.raises(HTTPException) as exc_info:
            resolve_partner_for_manager_email(db, email, raise_if_ambiguous=True)
        assert exc_info.value.status_code == 409
        assert "belongs to multiple partners" in str(exc_info.value.detail)

    def test_assert_manager_email_allowed_scoped(self, db: Session, test_partners):
        partner_a, partner_b = test_partners
        shared_domain = f"assert-{uuid.uuid4().hex[:6]}.com"

        create_manager_domain(db, shared_domain, partner_a.id)
        create_manager_domain(db, shared_domain, partner_b.id)

        email = f"manager@{shared_domain}"
        assert assert_manager_email_allowed(db, email, partner_id=partner_a.id) == partner_a.id
        assert assert_manager_email_allowed(db, email, partner_id=partner_b.id) == partner_b.id

        # Disallowed domain for partner raises 403
        with pytest.raises(HTTPException) as exc_info:
            assert_manager_email_allowed(db, "manager@unknown.com", partner_id=partner_a.id)
        assert exc_info.value.status_code == 403

    def test_delete_manager_domain_isolation(self, db: Session, test_partners):
        partner_a, partner_b = test_partners
        shared_domain = f"delete-{uuid.uuid4().hex[:6]}.com"

        dom_a = create_manager_domain(db, shared_domain, partner_a.id)
        dom_b = create_manager_domain(db, shared_domain, partner_b.id)

        # Delete domain for partner A
        delete_manager_domain(db, dom_a.id)

        # Partner A no longer has it
        assert shared_domain not in list_manager_domain_strings(db, partner_id=partner_a.id)
        # Partner B still has it
        assert shared_domain in list_manager_domain_strings(db, partner_id=partner_b.id)

    def test_automated_roster_sources_partner_scoping(self, db: Session, test_partners):
        partner_a, partner_b = test_partners
        pattern = f"source-{uuid.uuid4().hex[:6]}@example.com"

        # 1. Add source to Partner A
        src_a = create_automated_source(db, pattern, partner_a.id)
        assert src_a.partner_id == partner_a.id

        # 2. Add same source to Partner B - must succeed
        src_b = create_automated_source(db, pattern, partner_b.id)
        assert src_b.partner_id == partner_b.id

        # 3. Add same source to Partner A again - must fail with 409
        with pytest.raises(HTTPException) as exc_info:
            create_automated_source(db, pattern, partner_a.id)
        assert exc_info.value.status_code == 409
        assert "already allowed for this partner" in str(exc_info.value.detail)
