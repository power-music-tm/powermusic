"""Edge + attack cases for manager email domain matching."""

from __future__ import annotations

import pytest

from app.partner_allowlists import email_matches_manager_domains, normalize_manager_domain


ALLOWED = ["@puregym.com", "jdgyms.co.uk"]


@pytest.mark.parametrize(
    "email,expected",
    [
        ("manager@puregym.com", True),
        ("Manager@PureGym.COM", True),
        ("a.b+tag@puregym.com", True),
        ("desk@jdgyms.co.uk", True),
        ("manager@evil.com", False),
        ("puregym.com@evil.com", False),
        ("manager@notpuregym.com", False),
        ("manager@puregym.com.evil.com", False),
        ("manager@sub.puregym.com", False),  # subdomain not in allowlist
        ("manager@puregym.com ", True),  # trailing space trimmed by matcher input path
        ("", False),
        ("no-at-sign", False),
        ("@puregym.com", False),
        ("manager@", False),
    ],
)
def test_email_matches_manager_domains_matrix(email, expected):
    assert email_matches_manager_domains(email, ALLOWED) is expected


def test_normalize_manager_domain_strips_at_and_lowercases():
    assert normalize_manager_domain("@PureGym.COM") == "puregym.com"
    assert normalize_manager_domain("  JDGyms.co.uk ") == "jdgyms.co.uk"


def test_normalize_rejects_empty():
    with pytest.raises(ValueError):
        normalize_manager_domain("")


def test_normalize_rejects_path_injection():
    with pytest.raises(ValueError):
        normalize_manager_domain("evil.com/../admin")


def test_normalize_rejects_email_as_domain():
    with pytest.raises(ValueError):
        normalize_manager_domain("user@evil.com")
