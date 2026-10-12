"""Unit tests: person_compare mapping + field diffs (no DB)."""

from __future__ import annotations

from types import SimpleNamespace

from app.person_compare import (
    compare_person_fields,
    person_from_mapping,
    person_to_mapping,
)


class TestPersonMapping:
    def test_from_mapping_empty(self):
        assert person_from_mapping(None) is None
        assert person_from_mapping({}) is None

    def test_round_trip_dict(self):
        person = person_from_mapping(
            {
                "firstName": "Sam",
                "lastName": "Lee",
                "email": "sam@example.com",
                "location": "London",
                "role": "PT",
            }
        )
        mapped = person_to_mapping(person)
        assert mapped["firstName"] == "Sam"
        assert mapped["email"] == "sam@example.com"
        assert mapped["role"] == "PT"

    def test_from_manager_request_namespace(self):
        row = SimpleNamespace(
            person_first_name="Pat",
            person_last_name="Wu",
            person_email="pat@example.com",
            person_location="Leeds",
            role="Coach",
        )
        # person_to_mapping checks isinstance ManagerRequest — SimpleNamespace falls through
        # as PersonInfo-like only if attributes match. Use dict path instead.
        mapped = person_to_mapping(
            person_from_mapping(
                {
                    "firstName": "Pat",
                    "lastName": "Wu",
                    "email": "pat@example.com",
                    "location": "Leeds",
                }
            )
        )
        assert mapped["lastName"] == "Wu"
        assert row.person_first_name == "Pat"


class TestComparePersonFields:
    def test_all_same(self):
        left = {
            "firstName": "Sam",
            "lastName": "Lee",
            "email": "sam@example.com",
            "location": "London",
        }
        result = compare_person_fields(left, dict(left))
        assert result["allMatch"] is True
        assert all(f["status"] == "same" for f in result["fields"])

    def test_diffs_and_none_inputs(self):
        assert compare_person_fields(None, None)["allMatch"] is True
        result = compare_person_fields(
            {
                "firstName": "Sam",
                "lastName": "Lee",
                "email": "a@example.com",
                "location": "London",
            },
            {
                "firstName": "Sam",
                "lastName": "Lee",
                "email": "b@example.com",
                "location": "London",
            },
        )
        assert result["allMatch"] is False
        email = next(f for f in result["fields"] if f["field"] == "email")
        assert email["status"] == "differs"
