"""Edge cases for nickname-dataset first-name matching (Potential flag)."""

from app.nickname_match import (
    first_names_nickname_match,
    is_nickname_only_first_match,
    rejected_nickname_pairs_scope,
    related_first_names,
)
from app.duplicate_matching import match_classification, match_classification_gll
from app import schemas


def _p(first, last, email, loc="Birmingham"):
    return schemas.PersonInfo(
        firstName=first,
        lastName=last,
        email=email,
        location=loc,
    )


class TestNicknameDatasetFirstMatch:
    def test_exact_match(self):
        assert first_names_nickname_match("Rubab", "rubab") is True

    def test_capitalization_and_spacing(self):
        assert first_names_nickname_match("RUBAB", "rubab") is True
        assert first_names_nickname_match("ru bab", "rubab") is True
        assert first_names_nickname_match("Ru  Bab", "RUBAB") is True
        assert first_names_nickname_match("Bob", "  ROBERT ") is True  # nickname + trim/case

    def test_true_nicknames(self):
        assert first_names_nickname_match("Bob", "Robert") is True
        assert first_names_nickname_match("Bill", "William") is True
        assert first_names_nickname_match("Mike", "Michael") is True
        assert first_names_nickname_match("Liz", "Elizabeth") is True
        assert first_names_nickname_match("Beth", "Elizabeth") is True
        assert first_names_nickname_match("Jon", "John") is True
        assert first_names_nickname_match("Jenny", "Jennifer") is True

    def test_alex_family_links_via_dataset(self):
        assert first_names_nickname_match("Alex", "Alexander") is True
        assert first_names_nickname_match("Alex", "Alexandra") is True
        # Shared diminutive "alex" / "sandy" (Potential — admin reviews)
        assert first_names_nickname_match("Alexander", "Alexandra") is True

    def test_short_token_does_not_glue_alex_to_alfred(self):
        # Both relate to "al"; length-2 shared tokens must not count alone.
        assert first_names_nickname_match("Alex", "Alfred") is False
        assert first_names_nickname_match("Alex", "Alan") is False

    def test_false_friends_not_in_dataset(self):
        assert first_names_nickname_match("Darcy", "Sally") is False
        assert first_names_nickname_match("Rubab", "Ruby") is False
        assert first_names_nickname_match("Oliver", "Christian") is False

    def test_empty_and_whitespace(self):
        assert first_names_nickname_match("", "Robert") is False
        assert first_names_nickname_match("Bob", None) is False
        assert first_names_nickname_match("  ", "Robert") is False

    def test_kate_catherine_katie(self):
        assert first_names_nickname_match("Kate", "Catherine") is True
        assert first_names_nickname_match("Katie", "Catherine") is True
        assert first_names_nickname_match("Kate", "Katherine") is True

    def test_nickname_only_helper(self):
        assert is_nickname_only_first_match("Bob", "Robert") is True
        assert is_nickname_only_first_match("Bob", "bob") is False
        assert is_nickname_only_first_match("Darcy", "Sally") is False

    def test_rejected_pair_suppresses_nickname_not_exact(self):
        rejected = {("bob", "robert")}
        assert first_names_nickname_match("Bob", "Robert", rejected_pairs=rejected) is False
        assert first_names_nickname_match("Bob", "bob", rejected_pairs=rejected) is True
        with rejected_nickname_pairs_scope(rejected):
            assert first_names_nickname_match("Robert", "Bob") is False
            # Different loc/email → without first_match only same_last (1 flag) → no Potential
            left = _p("Bob", "Smith", "a@x.com", "GymA")
            right = _p("Robert", "Smith", "b@x.com", "GymB")
            label, _ = match_classification(left, right)
            assert label is None
            from app.duplicate_matching import _field_flags
            flags = _field_flags(left, right, use_location=True)
            assert flags["first_match"] is False


class TestPotentialUsesNicknameNotJw:
    def test_spacing_variant_same_last_plus_location_is_potential(self):
        # Name entity (spacing-normalized first + same last) + location → potential
        left = _p("Ru Bab", "Smith", "a@x.com", "GymA")
        right = _p("RUBAB", "Smith", "b@x.com", "GymA")
        label, _ = match_classification(left, right)
        assert label == "potential_duplicate"

    def test_spacing_variant_confirmed_when_all_fields_align(self):
        left = _p("Ru Bab", "Smith", "same@x.com", "GymA")
        right = _p("RUBAB", "Smith", "same@x.com", "GymA")
        label, _ = match_classification(left, right)
        assert label == "confirmed_duplicate"

    def test_bob_robert_same_last_is_potential(self):
        # JW(bob,robert)=0.5 would FAIL old logic; dataset must pass.
        left = _p("Bob", "Smith", "a@x.com", "GymA")
        right = _p("Robert", "Smith", "b@x.com", "GymA")
        label, _ = match_classification(left, right)
        assert label == "potential_duplicate"

    def test_bob_robert_gll_last_first_potential(self):
        left = _p("Bob", "Smith", "a@x.com", None)
        right = _p("Robert", "Smith", "b@x.com", None)
        label, _ = match_classification_gll(left, right)
        assert label == "potential_duplicate"

    def test_darcy_sally_same_last_not_potential_on_first_alone(self):
        # same last + location, but first names not nicknames → still need 2 flags.
        # last+loc = potential without first. Use different loc so only last matches.
        left = _p("Darcy", "Smith", "a@x.com", "GymA")
        right = _p("Sally", "Smith", "b@x.com", "GymB")
        label, _ = match_classification(left, right)
        assert label is None

    def test_mike_michael_same_email_different_last_none(self):
        # Nickname first-match alone does not form Name; email alone is not enough.
        left = _p("Mike", "Johnson", "shared@example.com", "GymA")
        right = _p("Michael", "Smith", "shared@example.com", "GymB")
        label, _ = match_classification(left, right)
        assert label is None

    def test_mike_michael_same_last_and_email_potential(self):
        # Full Name entity (nickname first + same last) + email → potential
        left = _p("Mike", "Smith", "shared@example.com", "GymA")
        right = _p("Michael", "Smith", "shared@example.com", "GymB")
        label, _ = match_classification(left, right)
        assert label == "potential_duplicate"

    def test_alex_alfred_same_last_not_first_match(self):
        left = _p("Alex", "Smith", "a@x.com", "GymA")
        right = _p("Alfred", "Smith", "b@x.com", "GymB")
        # last only (1 flag) if first_match false → None
        label, _ = match_classification(left, right)
        assert label is None
        from app.duplicate_matching import _field_flags
        flags = _field_flags(left, right, use_location=True)
        assert flags["first_match"] is False
        assert flags["same_last"] is True
