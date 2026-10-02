"""Unit tests for same-person matching rules."""

from app import schemas
from app.person_match import same_person


def _person(**kwargs):
    defaults = dict(firstName="Nik", lastName="Hall", email="nik@example.com", location="Alfreton")
    defaults.update(kwargs)
    return schemas.PersonInfo(**defaults)


class TestSamePerson:
    def test_all_fields_match(self):
        assert same_person(_person(), _person())

    def test_name_email_diff_location(self):
        assert same_person(_person(location="Alfreton"), _person(location="London"))

    def test_email_location_diff_name(self):
        assert same_person(
            _person(firstName="Nik", lastName="Hall"),
            _person(firstName="Nick", lastName="Hall"),
        )

    def test_name_location_diff_email(self):
        assert same_person(
            _person(email="a@example.com"),
            _person(email="b@example.com"),
        )

    def test_same_email_only(self):
        assert same_person(
            _person(firstName="Ann", lastName="One", email="shared@example.com", location="Leeds"),
            _person(firstName="Bob", lastName="Two", email="shared@example.com", location="York"),
        )

    def test_different_people(self):
        assert not same_person(
            _person(firstName="Ann", lastName="Lee", email="ann@example.com", location="Leeds"),
            _person(firstName="Bob", lastName="Smith", email="bob@example.com", location="Bristol"),
        )

    def test_name_only_not_enough(self):
        assert not same_person(
            _person(email="a@example.com", location="Leeds"),
            _person(email="b@example.com", location="York"),
        )

    def test_location_only_not_enough(self):
        assert not same_person(
            _person(firstName="Ann", lastName="Lee", email="a@example.com"),
            _person(firstName="Bob", lastName="Smith", email="b@example.com"),
        )
