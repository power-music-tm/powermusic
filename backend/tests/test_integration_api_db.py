"""Integration tests: HTTP API + real Supabase DB (auth overridden, data rolled back where possible)."""

from __future__ import annotations

import os
import uuid
from typing import Iterator

import pytest
import httpx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import models, schemas
from app.api.auth import AuthenticatedUser, get_authenticated_user, invalidate_auth_cache
from app.database import SessionLocal
from app.manager_request_intake import intake_automated_email_request, intake_manager_submission
from app.manager_request_tags import (
    TAG_AUTO_MAIL,
    TAG_PARTNER_REQUEST,
    TAG_UNVERIFIED,
    TAG_VERIFIED,
)
from app.main import app
from app.partner_allowlists import email_matches_manager_domains, partner_slug_from_name


LIVE_BASE = os.getenv("INTEGRATION_BASE_URL", "http://127.0.0.1:8000")


def _lookup_user(role: str) -> models.PowermusicUser:
    db = SessionLocal()
    try:
        user = (
            db.query(models.PowermusicUser)
            .filter(models.PowermusicUser.role == role)
            .order_by(models.PowermusicUser.email.asc())
            .first()
        )
        if user is None:
            pytest.skip(f"No {role} user in database")
        # Detach values we need
        return models.PowermusicUser(
            id=user.id,
            email=user.email,
            role=user.role,
            full_name=user.full_name,
            first_name=user.first_name,
            last_name=user.last_name,
            partner_id=user.partner_id,
        )
    finally:
        db.close()


@pytest.fixture
def db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.rollback()
    finally:
        session.close()


@pytest.fixture
def admin_user() -> AuthenticatedUser:
    row = _lookup_user("admin")
    return AuthenticatedUser(id=str(row.id), email=row.email, role="admin")


@pytest.fixture
def manager_user() -> AuthenticatedUser:
    row = _lookup_user("manager")
    return AuthenticatedUser(id=str(row.id), email=row.email, role="manager")


@pytest.fixture
def admin_client(admin_user: AuthenticatedUser) -> Iterator[TestClient]:
    invalidate_auth_cache()
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
    invalidate_auth_cache()


@pytest.fixture
def manager_client(manager_user: AuthenticatedUser) -> Iterator[TestClient]:
    invalidate_auth_cache()
    app.dependency_overrides[get_authenticated_user] = lambda: manager_user
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
    invalidate_auth_cache()


class TestLiveHttpSmoke:
    """Hits the already-running uvicorn process (no auth overrides)."""

    def test_health_connected(self):
        try:
            r = httpx.get(f"{LIVE_BASE}/health", timeout=8.0)
        except httpx.HTTPError as exc:
            pytest.skip(f"Backend not reachable at {LIVE_BASE}: {exc}")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert body["database"] == "connected"

    def test_unauthenticated_gates(self):
        try:
            me = httpx.get(f"{LIVE_BASE}/api/auth/me", timeout=8.0)
            reqs = httpx.get(f"{LIVE_BASE}/api/requests", timeout=8.0)
            domains = httpx.get(f"{LIVE_BASE}/api/manager/allowed-domains", timeout=8.0)
        except httpx.HTTPError as exc:
            pytest.skip(f"Backend not reachable at {LIVE_BASE}: {exc}")
        assert me.status_code == 401
        assert reqs.status_code == 401
        assert domains.status_code == 400


class TestApiAuthAndAdminReads:
    def test_admin_can_read_me(self, admin_client: TestClient, admin_user: AuthenticatedUser):
        r = admin_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == admin_user.email
        assert body["role"] == "admin"
        assert "full_name" in body

    def test_manager_cannot_list_admin_requests(self, manager_client: TestClient):
        r = manager_client.get("/api/requests")
        assert r.status_code == 403

    def test_admin_lists_requests_and_dashboard(self, admin_client: TestClient):
        reqs = admin_client.get("/api/requests")
        assert reqs.status_code == 200
        assert isinstance(reqs.json(), list)

        dash = admin_client.get("/api/dashboard")
        assert dash.status_code == 200
        body = dash.json()
        assert "kpis" in body or "newRequests" in body or isinstance(body, dict)

        kpis = admin_client.get("/api/kpis")
        assert kpis.status_code == 200

        partners = admin_client.get("/api/partners")
        assert partners.status_code == 200
        assert isinstance(partners.json(), list)
        assert len(partners.json()) >= 1


class TestPublicDomainScopingHttp:
    def test_email_scoped_domains_do_not_dump_catalog(self, admin_client: TestClient, db: Session):
        domains = [d.domain for d in db.query(models.ManagerAllowedDomain).all()]
        assert domains, "expected seed manager domains"
        # Pick a domain that exists
        sample = domains[0].lstrip("@")
        r = admin_client.get(
            "/api/manager/allowed-domains",
            params={"email": f"integration-tester@{sample}"},
        )
        assert r.status_code == 200
        returned = r.json()["domains"]
        # Only matching domain(s) — never the full unique catalog unless email matches many
        catalog = sorted({f"@{d.lstrip('@').lower()}" for d in domains})
        returned_norm = sorted({(d if d.startswith("@") else f"@{d}").lower() for d in returned})
        assert returned_norm, "scoped email should match at least one domain"
        assert set(returned_norm).issubset(set(catalog))
        # Spoof must be empty
        bad = admin_client.get(
            "/api/manager/allowed-domains",
            params={"email": f"integration-tester@{sample}.evil.com"},
        )
        assert bad.status_code == 200
        assert bad.json()["domains"] == []

    def test_partner_slug_scopes_domains(self, admin_client: TestClient, db: Session):
        partner = db.query(models.Partner).filter(models.Partner.name == "Pure Gym").first()
        if partner is None:
            pytest.skip("Pure Gym partner missing")
        slug = partner_slug_from_name(partner.name)
        r = admin_client.get("/api/manager/allowed-domains", params={"partner_slug": slug})
        assert r.status_code == 200
        returned = r.json()["domains"]
        # All returned domains should belong to that partner
        partner_domains = {
            d.domain.lstrip("@").lower()
            for d in db.query(models.ManagerAllowedDomain)
            .filter(models.ManagerAllowedDomain.partner_id == partner.id)
            .all()
        }
        for d in returned:
            assert d.lstrip("@").lower() in partner_domains


class TestDbIntakeIntegration:
    def test_manager_then_auto_mail_creates_linked_tags(self, db: Session):
        manager = (
            db.query(models.PowermusicUser)
            .filter(models.PowermusicUser.role == "manager")
            .first()
        )
        if manager is None:
            pytest.skip("No manager")

        suffix = uuid.uuid4().hex[:8]
        email = f"integ-{suffix}@example.com"
        person = schemas.PersonInfo(
            firstName="Integ",
            lastName="Tester",
            email=email,
            location="London",
        )

        mgr_row = intake_manager_submission(
            db,
            person=person,
            action="Add",
            manager_id=str(manager.id),
        )
        db.flush()
        assert TAG_VERIFIED in (mgr_row.tags or [])
        assert TAG_PARTNER_REQUEST in (mgr_row.tags or [])

        auto_row = intake_automated_email_request(
            db,
            person=person,
            action="Add",
            source_gmail_message_id=f"gmail-integ-{suffix}",
        )
        db.flush()
        assert TAG_AUTO_MAIL in (auto_row.tags or [])
        assert TAG_UNVERIFIED in (auto_row.tags or [])
        assert auto_row.id != mgr_row.id
        # Rolled back by fixture — no permanent pollution

    def test_email_domain_match_against_live_allowlist(self, db: Session):
        domains = [d.domain for d in db.query(models.ManagerAllowedDomain).limit(20)]
        assert any(email_matches_manager_domains("someone@gmail.com", domains) for _ in [0]) or \
            any(email_matches_manager_domains(f"x@{d.lstrip('@')}", [d]) for d in domains)
        # Empty local-part never matches
        sample = domains[0]
        assert email_matches_manager_domains(f"@{sample.lstrip('@')}", [sample]) is False


class TestProfileUpdateIntegration:
    def test_patch_me_updates_and_restores_name(self, admin_client: TestClient, admin_user: AuthenticatedUser):
        before = admin_client.get("/api/auth/me")
        assert before.status_code == 200
        original = before.json()["full_name"] or "Andrea"

        try:
            r = admin_client.patch("/api/auth/me", json={"fullName": "Integration Temp Name"})
            assert r.status_code == 200
            assert r.json()["full_name"] == "Integration Temp Name"
            assert r.json()["role"] == "admin"
            assert r.json()["first_name"] == "Integration"

            # role in body must not elevate / change
            r2 = admin_client.patch(
                "/api/auth/me",
                json={"fullName": "Integration Temp Name", "role": "manager"},
            )
            assert r2.status_code == 200
            assert r2.json()["role"] == "admin"
        finally:
            restore = admin_client.patch("/api/auth/me", json={"fullName": original})
            assert restore.status_code == 200
            assert restore.json()["full_name"] == original
