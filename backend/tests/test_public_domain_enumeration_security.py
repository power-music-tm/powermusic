"""Security tests: public allowlist / branding endpoints must not leak catalogs.

Attack models covered:
- Domain enumeration (unscoped dump of all partner email domains)
- Suffix / lookalike email tricks against scoped matching
- Missing / malformed inputs
- Partner slug probing for non-existent partners
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_db
from app.api.routers import pilot1 as pilot1_router

ALL_DOMAINS = ["@puregym.com", "@jdgyms.co.uk", "@healthandfitness.org", "@secret-partner.internal"]


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(pilot1_router.router)
    app.dependency_overrides[get_db] = lambda: MagicMock()
    return TestClient(app)


class TestAllowedDomainsAntiEnumeration:
    def test_unscoped_request_is_rejected(self, client):
        """Attacker must not get the full domain catalog with a bare GET."""
        with patch.object(pilot1_router, "list_manager_domain_strings") as list_domains:
            r = client.get("/api/manager/allowed-domains")
        assert r.status_code == 400
        assert "email" in r.json()["detail"].lower() or "partner_slug" in r.json()["detail"].lower()
        list_domains.assert_not_called()

    def test_empty_email_is_rejected(self, client):
        with patch.object(pilot1_router, "list_manager_domain_strings") as list_domains:
            r = client.get("/api/manager/allowed-domains", params={"email": "   "})
        assert r.status_code == 400
        list_domains.assert_not_called()

    def test_email_without_at_is_rejected(self, client):
        with patch.object(pilot1_router, "list_manager_domain_strings") as list_domains:
            r = client.get("/api/manager/allowed-domains", params={"email": "not-an-email"})
        assert r.status_code == 400
        list_domains.assert_not_called()

    def test_allowed_email_returns_only_matching_domain(self, client):
        with patch.object(pilot1_router, "list_manager_domain_strings", return_value=list(ALL_DOMAINS)):
            r = client.get(
                "/api/manager/allowed-domains",
                params={"email": "manager@PureGym.com"},
            )
        assert r.status_code == 200
        domains = r.json()["domains"]
        assert domains == ["@puregym.com"] or domains == ["puregym.com"]
        assert "@jdgyms.co.uk" not in domains
        assert "@secret-partner.internal" not in domains

    def test_disallowed_email_returns_empty_not_catalog(self, client):
        """Negative check must not leak other partners' domains."""
        with patch.object(pilot1_router, "list_manager_domain_strings", return_value=list(ALL_DOMAINS)):
            r = client.get(
                "/api/manager/allowed-domains",
                params={"email": "attacker@evil.com"},
            )
        assert r.status_code == 200
        assert r.json()["domains"] == []

    @pytest.mark.parametrize(
        "email",
        [
            "puregym.com@evil.com",
            "fake-puregym.com@evil.com",
            "manager@notpuregym.com",
            "manager@puregym.com.evil.com",
            "manager@evilpuregym.com",
        ],
    )
    def test_suffix_spoof_emails_do_not_match(self, client, email):
        with patch.object(pilot1_router, "list_manager_domain_strings", return_value=["@puregym.com"]):
            r = client.get("/api/manager/allowed-domains", params={"email": email})
        assert r.status_code == 200
        assert r.json()["domains"] == []

    def test_unknown_partner_slug_is_404(self, client):
        with patch.object(pilot1_router, "get_partner_by_slug", return_value=None):
            r = client.get(
                "/api/manager/allowed-domains",
                params={"partner_slug": "does-not-exist"},
            )
        assert r.status_code == 404

    def test_partner_slug_returns_only_that_partner_domains(self, client):
        partner = SimpleNamespace(id="partner-a", name="JD Gyms")
        with patch.object(pilot1_router, "get_partner_by_slug", return_value=partner), patch.object(
            pilot1_router,
            "list_manager_domain_strings",
            return_value=["@jdgyms.co.uk"],
        ) as list_domains:
            r = client.get(
                "/api/manager/allowed-domains",
                params={"partner_slug": "jd-gyms"},
            )
        assert r.status_code == 200
        assert r.json()["domains"] == ["@jdgyms.co.uk"]
        list_domains.assert_called_once()
        assert list_domains.call_args.kwargs.get("partner_id") == "partner-a"


class TestPublicPartnerBrandingHardening:
    def test_missing_email_is_400(self, client):
        r = client.get("/api/public/partner-branding")
        assert r.status_code == 400

    def test_unknown_domain_is_404_not_500(self, client):
        with patch.object(pilot1_router, "resolve_partner_for_manager_email", return_value=None):
            r = client.get(
                "/api/public/partner-branding",
                params={"email": "nobody@unknown.example"},
            )
        assert r.status_code == 404

    def test_sql_injection_style_email_does_not_500(self, client):
        with patch.object(pilot1_router, "resolve_partner_for_manager_email", return_value=None):
            r = client.get(
                "/api/public/partner-branding",
                params={"email": "a' OR '1'='1@evil.com"},
            )
        assert r.status_code in (400, 404)


class TestPublicCustomFormHardening:
    def test_unknown_slug_is_404(self, client):
        with patch.object(pilot1_router, "get_partner_by_slug", return_value=None):
            r = client.get("/api/public/custom-form/not-a-real-partner")
        assert r.status_code == 404

    def test_response_omits_logo_data_url_duplicate(self, client):
        partner = SimpleNamespace(id="p1", name="PureGym")
        form = SimpleNamespace(fields=[{"id": "club", "label": "Club"}], partner_id="p1")
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = form
        client.app.dependency_overrides[get_db] = lambda: db

        with patch.object(pilot1_router, "get_partner_by_slug", return_value=partner), patch.object(
            pilot1_router, "migrate_inline_logo_to_storage"
        ), patch.object(pilot1_router, "resolve_partner_logo", return_value="https://cdn.example/logo.png"), patch.object(
            pilot1_router, "list_manager_domain_strings", return_value=["@puregym.com"]
        ):
            r = client.get("/api/public/custom-form/puregym")

        assert r.status_code == 200
        body = r.json()
        assert "logoDataUrl" not in body
        assert body["logoUrl"] == "https://cdn.example/logo.png"
        assert body["allowedDomains"] == ["@puregym.com"]
        assert body["partnerName"] == "PureGym"
