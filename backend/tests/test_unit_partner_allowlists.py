"""Unit tests: pure partner_allowlists helpers (no DB)."""

from __future__ import annotations

import pytest

from app.partner_allowlists import (
    email_matches_manager_domains,
    normalize_manager_domain,
    normalize_partner_name,
    partner_slug_from_name,
)


class TestNormalizeManagerDomain:
    def test_strips_at_and_lowercases(self):
        assert normalize_manager_domain(" @ActiveGym.COM ") == "activegym.com"
        assert normalize_manager_domain("activegym.com") == "activegym.com"

    def test_rejects_email_shaped(self):
        with pytest.raises(ValueError, match="valid domain"):
            normalize_manager_domain("user@activegym.com")

    def test_rejects_no_dot(self):
        with pytest.raises(ValueError, match="valid domain"):
            normalize_manager_domain("localhost")

    def test_rejects_spaces_and_slashes(self):
        with pytest.raises(ValueError):
            normalize_manager_domain("bad domain.com")
        with pytest.raises(ValueError):
            normalize_manager_domain("evil.com/path")

    def test_rejects_empty(self):
        with pytest.raises(ValueError):
            normalize_manager_domain("   ")


class TestNormalizePartnerName:
    def test_collapses_whitespace(self):
        assert normalize_partner_name("  Pure   Gym  ") == "Pure Gym"

    def test_required(self):
        with pytest.raises(ValueError, match="required"):
            normalize_partner_name("  ")

    def test_too_long(self):
        with pytest.raises(ValueError, match="too long"):
            normalize_partner_name("x" * 121)


class TestEmailMatchesManagerDomains:
    def test_exact_domain_match(self):
        assert email_matches_manager_domains("sam@puregym.com", ["puregym.com"]) is True
        assert email_matches_manager_domains("sam@puregym.com", ["@puregym.com"]) is True

    def test_empty_local_part_rejected(self):
        assert email_matches_manager_domains("@puregym.com", ["puregym.com"]) is False

    def test_spoof_suffix_rejected(self):
        assert email_matches_manager_domains("sam@notpuregym.com", ["puregym.com"]) is False
        assert email_matches_manager_domains("sam@puregym.com.evil.com", ["puregym.com"]) is False

    def test_invalid_email(self):
        assert email_matches_manager_domains("not-an-email", ["puregym.com"]) is False
        assert email_matches_manager_domains("", ["puregym.com"]) is False


class TestPartnerSlugFromName:
    def test_slugifies(self):
        assert partner_slug_from_name("Pure Gym") == "pure-gym"
        assert partner_slug_from_name("  Health & Fitness! ") == "health--fitness"
        assert partner_slug_from_name("") == ""
