"""Unit tests: ignore_list parse / match (no DB)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.pilot2.ignore_list import (
    is_message_ignored,
    is_sender_ignored,
    parse_ignore_pattern,
    sender_matches_rule,
)


class TestParseIgnorePattern:
    def test_email(self):
        assert parse_ignore_pattern(" Boss@Company.COM ") == ("email", "boss@company.com")

    def test_at_domain(self):
        assert parse_ignore_pattern("@Spam.COM") == ("domain", "spam.com")

    def test_bare_domain(self):
        assert parse_ignore_pattern("newsletter.io") == ("domain", "newsletter.io")

    def test_rejects_empty(self):
        with pytest.raises(ValueError, match="email address or domain"):
            parse_ignore_pattern("  ")

    def test_rejects_bad_email(self):
        with pytest.raises(ValueError, match="valid email"):
            parse_ignore_pattern("bad@@x.com")
        with pytest.raises(ValueError, match="valid email"):
            parse_ignore_pattern("no-local@")

    def test_rejects_bad_domain(self):
        with pytest.raises(ValueError):
            parse_ignore_pattern("@bad domain")
        with pytest.raises(ValueError):
            parse_ignore_pattern("evil.com/path")


class TestSenderMatchesRule:
    def test_email_exact(self):
        assert sender_matches_rule("a@b.com", "email", "a@b.com") is True
        assert sender_matches_rule("A@B.COM", "email", "a@b.com") is True
        assert sender_matches_rule("other@b.com", "email", "a@b.com") is False

    def test_domain_suffix(self):
        assert sender_matches_rule("x@spam.com", "domain", "spam.com") is True
        assert sender_matches_rule("x@notspam.com", "domain", "spam.com") is False
        assert sender_matches_rule("", "domain", "spam.com") is False


class TestIsSenderIgnored:
    def test_matches_inbox_scoped_rules(self):
        rules = [
            SimpleNamespace(account_email="inbox@pm.com", kind="domain", pattern="spam.com"),
            SimpleNamespace(account_email="other@pm.com", kind="email", pattern="a@b.com"),
        ]
        assert is_sender_ignored("x@spam.com", "inbox@pm.com", rules) is True
        assert is_sender_ignored("a@b.com", "inbox@pm.com", rules) is False
        assert is_sender_ignored("a@b.com", "other@pm.com", rules) is True

    def test_message_checks_original_from(self):
        rules = [
            SimpleNamespace(account_email="inbox@pm.com", kind="email", pattern="orig@spam.com"),
        ]
        assert (
            is_message_ignored(
                "relay@pm.com",
                "inbox@pm.com",
                rules,
                original_from_email="orig@spam.com",
            )
            is True
        )
        assert is_message_ignored("relay@pm.com", "inbox@pm.com", rules) is False
