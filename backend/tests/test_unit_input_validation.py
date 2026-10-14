"""Unit tests: app.input_validation — every public normalizer + edge cases."""

from __future__ import annotations

import pytest

from app.input_validation import (
    csv_cell,
    normalize_club_label,
    normalize_email,
    normalize_person_name,
    normalize_person_notes,
    normalize_roster_person_location,
    normalize_roster_person_name,
    normalize_search_query,
    normalize_text,
    strip_control_chars,
)


class TestStripControlChars:
    def test_none(self):
        assert strip_control_chars(None) is None

    def test_strips_null_and_controls(self):
        assert strip_control_chars("ab\x00c\x07d") == "abcd"

    def test_whitespace_only_becomes_none(self):
        assert strip_control_chars("   ") is None

    def test_trims(self):
        assert strip_control_chars("  hello  ") == "hello"


class TestNormalizeText:
    def test_empty_without_allow_empty_returns_blank(self):
        # strip_control_chars maps blank → None; normalize_text then returns "" when
        # allow_empty=False (callers that need a hard required check use dedicated helpers).
        assert normalize_text("", max_length=10, field_name="Title") == ""
        assert normalize_text("   ", max_length=10, field_name="Title") == ""
        assert normalize_text(None, max_length=10, field_name="Title") == ""

    def test_max_length(self):
        with pytest.raises(ValueError, match="at most"):
            normalize_text("abcdefghijk", max_length=10, field_name="Title")

    def test_rejects_html_when_asked(self):
        with pytest.raises(ValueError, match="HTML"):
            normalize_text("<b>x</b>", max_length=20, reject_html=True, field_name="Title")

    def test_allows_empty_when_configured(self):
        assert normalize_text(None, max_length=10, allow_empty=True) is None
        assert normalize_text("  ", max_length=10, allow_empty=True) is None


class TestNormalizeEmail:
    def test_lowercases(self):
        assert normalize_email("Alex@Example.COM") == "alex@example.com"

    def test_invalid(self):
        with pytest.raises(ValueError, match="invalid email"):
            normalize_email("not-an-email")

    def test_required_missing(self):
        with pytest.raises(ValueError):
            normalize_email("", required=True)

    def test_optional_empty(self):
        assert normalize_email(None) is None


class TestNormalizePersonName:
    @pytest.mark.parametrize(
        "value",
        ["Marie", "Marie-Claire", "O'Brien", "José", "Anne Marie"],
    )
    def test_accepts_valid(self, value):
        assert normalize_person_name(value, required=True) == value

    @pytest.mark.parametrize(
        "value",
        ["John2", "<script>x</script>", "A!", "", "123"],
    )
    def test_rejects_invalid(self, value):
        with pytest.raises(ValueError):
            normalize_person_name(value, required=True)


class TestNormalizeRosterFields:
    def test_roster_name_accepts_spaces_rejects_hyphens(self):
        assert normalize_roster_person_name("Mary Ann", required=True) == "Mary Ann"
        with pytest.raises(ValueError, match="letters and spaces only"):
            normalize_roster_person_name("Anna-Lisa", required=True)

    def test_roster_name_accepts_letters(self):
        assert normalize_roster_person_name("José", required=True) == "José"

    def test_roster_location_accepts_spaces(self):
        assert (
            normalize_roster_person_location("Pure Gym London", required=True)
            == "Pure Gym London"
        )

    def test_roster_location_rejects_numbers(self):
        with pytest.raises(ValueError):
            normalize_roster_person_location("Gym 12", required=True)


class TestNormalizeNotesClubSearch:
    def test_notes_reject_html(self):
        with pytest.raises(ValueError, match="HTML"):
            normalize_person_notes("<img src=x>")

    def test_club_optional(self):
        assert normalize_club_label(None) is None
        assert normalize_club_label("  London  ") == "London"

    def test_search_query_empty(self):
        assert normalize_search_query("") == ""

    def test_search_query_trims_controls(self):
        assert normalize_search_query("  Sam\x00  ") == "Sam"


class TestCsvCell:
    @pytest.mark.parametrize(
        "raw,expected_prefix",
        [
            ("=CMD", '"\'='),
            ("+1+1", '"\'+'),
            ("-1", '"\'-'),
            ("@SUM(A1)", '"\'@'),
            ("hello", '"hello"'),
            (None, '""'),
            ('say "hi"', '"say ""hi"""'),
        ],
    )
    def test_formula_and_quote_escaping(self, raw, expected_prefix):
        out = csv_cell(raw)
        assert out.startswith(expected_prefix) or out == expected_prefix
        assert out.startswith('"') and out.endswith('"')
