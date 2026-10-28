"""
Focused unit tests for the field-flag duplicate-matching rule.

Covers all cases mandated by the task specification:
  - 4-field partners (PureGym / Health Fitness)
  - GLL 3-field (no location)
  - Boundary conditions (JW=0.65, empty/None/whitespace)

No database is needed; all tests call match_classification*() directly.
"""

from __future__ import annotations

import pytest
from app import schemas
from app.duplicate_matching import (
    match_classification,
    match_classification_gll,
    match_classification_for_partner,
    _field_flags,
    FIRST_NAME_MATCH_MIN,
    MIN_MATCHED_FIELDS_FOR_POTENTIAL,
    POTENTIAL_DUPLICATE_THRESHOLD,
    GLL_POTENTIAL_DUPLICATE_THRESHOLD,
    jaro_winkler,
)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _p(first="John", last="Smith", email=None, location=None):
    return schemas.PersonInfo(
        firstName=first,
        lastName=last,
        email=email,
        location=location,
    )


# ===========================================================================
# 4-FIELD PARTNERS
# ===========================================================================

class TestFourFieldClassification:

    # Test 1 – Clinton/Harry vs Hover, different email/location → potential
    def test_01_clinton_harry_vs_hover_potential(self):
        left  = _p("Harry", "Clinton", "harry@example.com", "GymA")
        right = _p("Harry", "Hover",   "hover@example.com", "GymB")
        # same first (first_match=True), different last, different email, different loc
        # anchored by: neither same_last nor same_email  → None
        # Per spec the names are "Clinton, Harry" and "Hover" — different last names,
        # same first name only.  Must return None (first-name alone cannot create potential).
        label, score = match_classification(left, right)
        assert label is None, (
            f"Clinton/Harry vs Hover with different last/email should be None, got {label} "
            f"(score={score:.2f})"
        )

    # Test 2 – Green/Oliver vs Green/Christian, different email/location → None
    def test_02_green_oliver_vs_christian_none(self):
        left  = _p("Oliver",    "Green", "oliver@example.com", "GymA")
        right = _p("Christian", "Green", "chris@example.com",  "GymB")
        # same_last=True, first_match depends on JW("oliver","christian")
        # oliver vs christian → very low JW; same_email=False; same_loc=False
        # matched=1 (same_last only) → below MIN_MATCHED_FIELDS_FOR_POTENTIAL=2 → None
        label, _ = match_classification(left, right)
        assert label is None, f"Same last only (Green) should be None, got {label}"

    # Test 3 – All four identical → confirmed
    def test_03_all_four_identical_confirmed(self):
        p = _p("Jane", "Doe", "jane@example.com", "London")
        label, score = match_classification(p, p)
        assert label == "confirmed_duplicate"
        assert score == 100.0

    # Test 4 – Same last + same first, different email/location → None
    # first+last alone is never enough without email or location.
    def test_04_same_last_same_first_different_email_loc_none(self):
        left  = _p("John", "Smith", "a@example.com", "GymA")
        right = _p("John", "Smith", "b@example.com", "GymB")
        label, _ = match_classification(left, right)
        assert label is None, (
            f"first+last alone should be None without email/loc, got {label}"
        )

    # Test 4b – Name + email (different location) → confirmed (exact email)
    def test_04b_name_plus_email_confirmed(self):
        left  = _p("John", "Smith", "shared@example.com", "GymA")
        right = _p("John", "Smith", "shared@example.com", "GymB")
        label, _ = match_classification(left, right)
        assert label == "confirmed_duplicate", (
            f"Same email should be confirmed_duplicate, got {label}"
        )

    # Test 4c – first+last+location (different email) → potential
    def test_04c_name_plus_location_potential(self):
        left  = _p("John", "Smith", "a@example.com", "GymA")
        right = _p("John", "Smith", "b@example.com", "GymA")
        label, _ = match_classification(left, right)
        assert label == "potential_duplicate", (
            f"first+last+location should be potential_duplicate, got {label}"
        )

    # Test 4d – first+location alone (different last/email) → None
    def test_04d_first_plus_location_alone_none(self):
        left  = _p("John", "Smith", "a@example.com", "GymA")
        right = _p("John", "Taylor", "b@example.com", "GymA")
        label, _ = match_classification(left, right)
        assert label is None, (
            f"first+location alone should be None, got {label}"
        )

    # Test 5 – Same last only → None
    def test_05_same_last_only_none(self):
        left  = _p("Alice", "Brown", "alice@example.com", "GymA")
        right = _p("Zoe",   "Brown", "zoe@example.com",   "GymB")
        # JW("alice","zoe") is very low → first_match=False
        label, _ = match_classification(left, right)
        assert label is None, f"Same last only should be None, got {label}"

    # Test 6 – Same email only → confirmed (complete match)
    def test_06_same_email_only_confirmed(self):
        left  = _p("Alice", "Brown",  "shared@example.com", "GymA")
        right = _p("Zoe",   "Taylor", "shared@example.com", "GymB")
        label, _ = match_classification(left, right)
        assert label == "confirmed_duplicate", (
            f"Same email only should be confirmed_duplicate, got {label}"
        )

    # Test 7 – Same last + same email, different first → confirmed (exact email)
    def test_07_same_last_same_email_different_first_confirmed(self):
        left  = _p("Alice", "Brown", "shared@example.com", "GymA")
        right = _p("Bob",   "Brown", "shared@example.com", "GymB")
        label, _ = match_classification(left, right)
        assert label == "confirmed_duplicate", (
            f"Same email should be confirmed_duplicate, got {label}"
        )

    # Test 8 – Same last + same location, different first → None (name incomplete)
    def test_08_same_last_same_location_different_first_none(self):
        left  = _p("Alice", "Brown", "alice@example.com", "GymA")
        right = _p("Bob",   "Brown", "bob@example.com",   "GymA")
        # name=False (first differs), email=False, loc=True → entity_matched=1 → None
        label, _ = match_classification(left, right)
        assert label is None, (
            f"Last + location without first match should be None, got {label}"
        )

    # Test 9 – Same email + same location → confirmed (exact email)
    def test_09_same_email_same_location_confirmed(self):
        left  = _p("Alice", "Brown",  "shared@example.com", "GymA")
        right = _p("Bob",   "Taylor", "shared@example.com", "GymA")
        label, _ = match_classification(left, right)
        assert label == "confirmed_duplicate", (
            f"Same email should be confirmed_duplicate, got {label}"
        )

    # Test 10 – Mike vs Michael, same email, different last → confirmed (exact email)
    def test_10_mike_vs_michael_same_email_different_last_confirmed(self):
        left  = _p("Mike",    "Johnson", "shared@example.com", "GymA")
        right = _p("Michael", "Smith",   "shared@example.com", "GymB")
        label, _ = match_classification(left, right)
        assert label == "confirmed_duplicate", (
            f"Same email should be confirmed_duplicate, got {label}"
        )

    # Test 11 – Same first only → None
    def test_11_same_first_only_none(self):
        left  = _p("John", "Smith",  "a@example.com", "GymA")
        right = _p("John", "Taylor", "b@example.com", "GymB")
        # first_match=True, same_last=False, same_email=False, same_loc=False
        # matched=1, anchored=False → None
        label, _ = match_classification(left, right)
        assert label is None, f"Same first name only should be None, got {label}"

    # Test 12 – Case/whitespace normalization; same email → confirmed
    def test_12_case_whitespace_normalization(self):
        left  = _p("John", "  Smith  ", "shared@example.com", "GymA")
        right = _p("John", "SMITH",     "shared@example.com", "GymB")
        label, _ = match_classification(left, right)
        assert label == "confirmed_duplicate", (
            f"Same email should be confirmed_duplicate; got {label}"
        )

    # Test 13 – Both emails empty → email does not count
    def test_13_both_emails_empty_does_not_count(self):
        left  = _p("John", "Smith", None, "GymA")
        right = _p("John", "Smith", None, "GymA")
        # same_email=False (both empty), same_last=True, first_match=True, same_loc=True
        # matched=3, anchored=True (same_last) → potential; but NOT confirmed (email absent)
        label, _ = match_classification(left, right)
        assert label in ("potential_duplicate",), (
            f"Both emails empty — email must not count; got {label}"
        )

    # Test 13b – Whitespace-only email does not count
    def test_13b_whitespace_email_does_not_count(self):
        flags = _field_flags(
            _p("John", "Smith", "   ", "GymA"),
            _p("John", "Smith", "   ", "GymA"),
            use_location=True,
        )
        assert flags["same_email"] is False, "Whitespace-only email must not count as match"

    # Test 14 – Green/Oliver directory + Green/Christian request → None
    # The spec intent: Oliver Green and Christian Green are different people.
    # With different locations, same last alone (1 flag) is below the minimum of 2.
    def test_14_green_oliver_directory_green_christian_none(self):
        directory = _p("Oliver",    "Green", "oliver@example.com", "GymA")
        request   = _p("Christian", "Green", "chris@example.com",  "GymB")
        label, _  = match_classification(directory, request)
        # same_last=True, first_match=False (not nicknames),
        # same_email=False, same_loc=False → matched=1 → None
        assert label is None, (
            f"Green/Oliver vs Green/Christian (different location/email) should be None; got {label}"
        )

    # Test 15 – Same location + Harry/Hover → None
    def test_15_same_location_harry_hover_none(self):
        left  = _p("Harry", "Clinton", "harry@example.com", "GymA")
        right = _p("Harry", "Hover",   "hover@example.com", "GymA")
        # same_loc=True, first_match=True (same "harry"), same_last=False, same_email=False
        # matched=2, anchored=False (neither same_last nor same_email) → None
        label, _ = match_classification(left, right)
        assert label is None, (
            f"Same location + Harry/Hover (different last, different email) should be None, got {label}"
        )

    # Test 16 – Same location + Mike/Michael → None
    def test_16_same_location_mike_michael_none(self):
        left  = _p("Mike",    "Johnson", "a@example.com", "GymA")
        right = _p("Michael", "Smith",   "b@example.com", "GymA")
        # same_loc=True, first_match=True (nickname dataset)
        # same_last=False, same_email=False → anchored=False → None even if matched=2
        label, _ = match_classification(left, right)
        assert label is None, (
            f"Same loc + Mike/Michael (no email/last anchor) should be None, got {label}"
        )

    # Test 17 – Same location + identical first name → None
    def test_17_same_location_identical_first_none(self):
        left  = _p("John", "Smith",  "a@example.com", "GymA")
        right = _p("John", "Taylor", "b@example.com", "GymA")
        # same_loc=True, first_match=True, same_last=False, same_email=False
        # matched=2, anchored=False → None
        label, _ = match_classification(left, right)
        assert label is None, (
            f"Same location + identical first (different last/email) should be None, got {label}"
        )


# ===========================================================================
# GLL (first / last / email / optional location)
# ===========================================================================

class TestGllFieldFlagClassification:

    def test_18_gll_same_first_only_none(self):
        left  = _p("Harry", "Clinton", "harry@example.com")
        right = _p("Harry", "Hover",   "hover@example.com")
        label, _ = match_classification_gll(left, right)
        assert label is None, (
            f"GLL same first only should be None, got {label}"
        )

    def test_19_gll_same_last_only_none(self):
        left  = _p("Oliver",    "Green", "oliver@example.com")
        right = _p("Christian", "Green", "chris@example.com")
        label, _ = match_classification_gll(left, right)
        assert label is None, f"GLL same last only should be None, got {label}"

    def test_20_gll_same_first_different_last_email_none(self):
        left  = _p("Bob", "Smith", "bob@example.com")
        right = _p("Bob", "Xyz",   "xyz@example.com")
        label, _ = match_classification_gll(left, right)
        assert label is None, f"GLL first only should be None, got {label}"

    def test_21_gll_same_email_confirmed(self):
        left  = _p("Alice", "Brown", "shared@example.com")
        right = _p("Bob",   "Brown", "shared@example.com")
        label, _ = match_classification_gll(left, right)
        assert label == "confirmed_duplicate", (
            f"GLL same email should be confirmed_duplicate, got {label}"
        )

    def test_22_gll_same_email_nickname_first_confirmed(self):
        left  = _p("Jon",  "Smith",  "shared@example.com")
        right = _p("John", "Taylor", "shared@example.com")
        label, _ = match_classification_gll(left, right)
        assert label == "confirmed_duplicate", (
            f"GLL same email should be confirmed_duplicate, got {label}"
        )

    def test_23_gll_all_identity_fields_confirmed(self):
        p = _p("John", "Smith", "john@example.com")
        label, score = match_classification_gll(p, p)
        assert label == "confirmed_duplicate"
        assert score == 75.0

    def test_24_gll_first_plus_last_potential(self):
        left  = _p("John", "Smith", "a@example.com")
        right = _p("John", "Smith", "b@example.com")
        label, _ = match_classification_gll(left, right)
        assert label == "potential_duplicate", (
            f"GLL first+last should be potential_duplicate, got {label}"
        )

    def test_25_gll_first_plus_location_potential(self):
        left  = _p("John", "Smith",  "a@example.com", "London")
        right = _p("John", "Taylor", "b@example.com", "London")
        label, _ = match_classification_gll(left, right)
        assert label == "potential_duplicate", (
            f"GLL first+location should be potential_duplicate, got {label}"
        )

    def test_26_gll_last_plus_location_alone_none(self):
        left  = _p("Alice", "Smith", "a@example.com", "London")
        right = _p("Bob",   "Smith", "b@example.com", "London")
        label, _ = match_classification_gll(left, right)
        assert label is None, (
            f"GLL last+location alone should be None, got {label}"
        )

    def test_27_gll_first_last_location_potential(self):
        left  = _p("John", "Smith", "a@example.com", "London")
        right = _p("John", "Smith", "b@example.com", "London")
        label, _ = match_classification_gll(left, right)
        assert label == "potential_duplicate", (
            f"GLL first+last+location should be potential_duplicate, got {label}"
        )

    def test_28_gll_empty_location_ignored(self):
        left  = _p("John", "Smith", "a@example.com", None)
        right = _p("John", "Taylor", "b@example.com", None)
        label, _ = match_classification_gll(left, right)
        assert label is None, (
            f"GLL first only with empty location should be None, got {label}"
        )


# ===========================================================================
# BOUNDARY CONDITIONS
# ===========================================================================

class TestBoundaryConditions:

    def test_nickname_dataset_not_jw_for_first_match(self):
        """First-match uses nickname dataset; Darcy/Sally must not match; Bob/Robert must."""
        from app.nickname_match import first_names_nickname_match

        assert first_names_nickname_match("Jon", "John") is True
        assert first_names_nickname_match("Bob", "Robert") is True
        assert first_names_nickname_match("Darcy", "Sally") is False
        assert first_names_nickname_match("Alice", "Zoe") is False
        assert first_names_nickname_match("Alex", "Alfred") is False

        flags = _field_flags(
            _p("Darcy", "Moore", "a@example.com", "Donyngs"),
            _p("Sally", "Moore", "b@example.com", "Barnet"),
            use_location=True,
        )
        assert flags["same_last"] is True
        assert flags["first_match"] is False

    def test_boundary_first_name_nickname_counts(self):
        """Nickname first_match forms Name entity; + location → potential."""
        left  = _p("Jon",  "Smith", "a@example.com", "GymA")
        right = _p("John", "Smith", "b@example.com", "GymA")
        label, _ = match_classification(left, right)
        assert label == "potential_duplicate", (
            f"jon/john Name + location should be potential_duplicate, got {label}"
        )

    def test_name_alone_not_potential(self):
        """Full Name entity without email or location is not enough."""
        left  = _p("Jon",  "Smith", "a@example.com", "GymA")
        right = _p("John", "Smith", "b@example.com", "GymB")
        label, _ = match_classification(left, right)
        assert label is None, f"Name alone should be None, got {label}"

    def test_empty_fields_never_count_as_match(self):
        """None, empty string, and whitespace-only values must not count as matches."""
        cases = [
            # (first_l, first_r, last_l, last_r, email_l, email_r, loc_l, loc_r)
            (None,  None,  "Smith", "Smith", "a@x.com", "a@x.com", None,  None),
            ("",    "",    "Smith", "Smith", "a@x.com", "a@x.com", "",    ""),
            ("  ",  "  ", "Smith", "Smith", "a@x.com", "a@x.com", "  ", "  "),
        ]
        for (fl, fr, ll, lr, el, er, lol, lor) in cases:
            flags = _field_flags(
                schemas.PersonInfo(firstName=fl, lastName=ll, email=el, location=lol),
                schemas.PersonInfo(firstName=fr, lastName=lr, email=er, location=lor),
                use_location=True,
            )
            assert flags["first_match"] is False, (
                f"Empty/None/whitespace first name must not count: fl={fl!r} fr={fr!r}"
            )

    def test_none_email_does_not_count(self):
        flags = _field_flags(_p("John", "Smith", None), _p("John", "Smith", None), use_location=False)
        assert flags["same_email"] is False

    def test_empty_email_does_not_count(self):
        flags = _field_flags(_p("John", "Smith", ""), _p("John", "Smith", ""), use_location=False)
        assert flags["same_email"] is False

    def test_none_location_does_not_count(self):
        flags = _field_flags(_p("John", "Smith", None, None), _p("John", "Smith", None, None), use_location=True)
        assert flags["same_loc"] is False

    def test_empty_location_does_not_count(self):
        flags = _field_flags(_p("John", "Smith", None, ""), _p("John", "Smith", None, ""), use_location=True)
        assert flags["same_loc"] is False

    def test_use_location_false_ignores_location(self):
        """When use_location=False, same_loc is always False regardless of values."""
        flags = _field_flags(
            _p("John", "Smith", "a@x.com", "London"),
            _p("John", "Smith", "a@x.com", "London"),
            use_location=False,
        )
        assert flags["same_loc"] is False

    def test_min_matched_fields_constant(self):
        assert MIN_MATCHED_FIELDS_FOR_POTENTIAL == 2

    def test_threshold_constants_preserved(self):
        """Numeric constants still exported unchanged (used for display)."""
        assert POTENTIAL_DUPLICATE_THRESHOLD == 45.0
        assert GLL_POTENTIAL_DUPLICATE_THRESHOLD == 33.75

    # First-name similarity alone can never create a potential duplicate (any partner)
    def test_first_name_alone_never_potential_4field(self):
        left  = _p("Michael", "Smith",  "a@x.com", "GymA")
        right = _p("Mike",    "Taylor", "b@x.com", "GymB")
        label, _ = match_classification(left, right)
        assert label is None

    def test_first_name_alone_never_potential_gll(self):
        left  = _p("Michael", "Smith",  "a@x.com")
        right = _p("Mike",    "Taylor", "b@x.com")
        label, _ = match_classification_gll(left, right)
        assert label is None

    # Score is still returned as float and weights are unchanged
    def test_score_still_returned_for_confirmed_4field(self):
        p = _p("Jane", "Doe", "j@pg.com", "London")
        label, score = match_classification(p, p)
        assert label == "confirmed_duplicate"
        assert score == 100.0  # 30+35+10+25

    def test_score_still_returned_for_confirmed_gll(self):
        p = _p("Jane", "Doe", "j@gll.com")
        label, score = match_classification_gll(p, p)
        assert label == "confirmed_duplicate"
        assert score == 75.0  # 30+35+10

    def test_score_returned_even_when_no_match(self):
        left  = _p("Alice", "Jones", "a@x.com", "GymA")
        right = _p("Bob",   "Brown", "z@x.com", "GymB")
        label, score = match_classification(left, right)
        assert label is None
        assert isinstance(score, float)

    def test_partner_router_gll_flag(self):
        p = _p("John", "Smith", "john@example.com")
        label_gll, _ = match_classification_for_partner(p, p, is_gll=True)
        assert label_gll == "confirmed_duplicate"

    def test_partner_router_4field_flag(self):
        p = _p("Jane", "Doe", "j@pg.com", "London")
        label, score = match_classification_for_partner(p, p, is_gll=False)
        assert label == "confirmed_duplicate"
        assert score == 100.0
