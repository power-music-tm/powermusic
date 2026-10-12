"""Unit tests: person_match same_person / GLL routing (no DB)."""

from __future__ import annotations

from app import schemas
from app.person_match import same_person, same_person_for_partner, same_person_gll


def _p(first="", last="", email="", location=""):
    return schemas.PersonInfo(
        firstName=first,
        lastName=last,
        email=email,
        location=location,
    )


class TestSamePerson:
    def test_all_four_match(self):
        assert same_person(
            _p("Sam", "Lee", "s@x.com", "London"),
            _p("sam", "lee", "S@X.COM", " london "),
        )

    def test_email_only_fallback(self):
        assert same_person(
            _p("Ann", "Bee", "same@x.com", "Here"),
            _p("Xia", "Yan", "same@x.com", "There"),
        )

    def test_name_and_location_without_email(self):
        assert same_person(
            _p("Sam", "Lee", "", "London"),
            _p("Sam", "Lee", "", "London"),
        )

    def test_no_overlap(self):
        assert not same_person(
            _p("Sam", "Lee", "a@x.com", "London"),
            _p("Pat", "Wu", "b@x.com", "Manchester"),
        )

    def test_empty_fields_do_not_match(self):
        assert not same_person(_p(), _p())


class TestSamePersonGll:
    def test_name_and_email(self):
        assert same_person_gll(
            _p("Sam", "Lee", "s@x.com", "Alpha"),
            _p("sam", "lee", "S@X.COM", "Beta"),
        )

    def test_email_only(self):
        assert same_person_gll(
            _p("Ann", "Bee", "same@x.com", "Alpha"),
            _p("Xia", "Yan", "same@x.com", "Beta"),
        )

    def test_location_ignored_when_emails_differ(self):
        assert not same_person_gll(
            _p("Sam", "Lee", "a@x.com", "London"),
            _p("Sam", "Lee", "b@x.com", "London"),
        )


class TestSamePersonForPartner:
    def test_routes_gll(self):
        left = _p("Sam", "Lee", "a@x.com", "London")
        right = _p("Sam", "Lee", "b@x.com", "London")
        assert same_person_for_partner(left, right, is_gll=False) is True
        assert same_person_for_partner(left, right, is_gll=True) is False
