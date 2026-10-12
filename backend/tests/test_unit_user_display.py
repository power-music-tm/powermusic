"""Unit tests: pure user_display helpers (no DB)."""

from __future__ import annotations

from types import SimpleNamespace

from app.user_display import split_full_name, user_display_name, user_manager_fields


class TestSplitFullName:
    def test_empty(self):
        assert split_full_name(None) == ("", "")
        assert split_full_name("   ") == ("", "")

    def test_single(self):
        assert split_full_name("Andrea") == ("Andrea", "")

    def test_multi(self):
        assert split_full_name("Andrea Petty") == ("Andrea", "Petty")
        assert split_full_name("  Mary  Ann  Smith ") == ("Mary", "Ann  Smith")


class TestUserManagerFields:
    def test_uses_first_last_when_present(self):
        user = SimpleNamespace(
            first_name="Alex",
            last_name="Manager",
            full_name="Ignored",
            email="a@b.com",
            club=" London ",
        )
        assert user_manager_fields(user) == {
            "firstName": "Alex",
            "lastName": "Manager",
            "email": "a@b.com",
            "club": "London",
        }

    def test_falls_back_to_full_name_split(self):
        user = SimpleNamespace(
            first_name=None,
            last_name="",
            full_name="Jordan Lee",
            email="j@x.com",
            club=None,
        )
        fields = user_manager_fields(user)
        assert fields["firstName"] == "Jordan"
        assert fields["lastName"] == "Lee"


class TestUserDisplayName:
    def test_none_user(self):
        assert user_display_name(None) == ""

    def test_prefers_first_last(self):
        user = SimpleNamespace(
            first_name="Sam",
            last_name="Lee",
            full_name="Unused",
            email="s@x.com",
            club="",
        )
        assert user_display_name(user) == "Sam Lee"

    def test_falls_back_to_email(self):
        user = SimpleNamespace(
            first_name="",
            last_name="",
            full_name="",
            email="only@example.com",
            club="",
        )
        assert user_display_name(user) == "only@example.com"
