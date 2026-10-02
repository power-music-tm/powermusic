"""Unit tests for person field comparison summaries."""

from app import schemas
from app.person_compare import compare_person_fields


def _person(**kwargs):
    defaults = dict(firstName="Mew", lastName="Bing", email="mew@bim.co.uk", location="hi")
    defaults.update(kwargs)
    return schemas.PersonInfo(**defaults)


class TestComparePersonFields:
    def test_all_same(self):
        result = compare_person_fields(_person(), _person())
        assert result["allMatch"] is True
        assert result["summary"] == "All same"

    def test_email_differs(self):
        result = compare_person_fields(
            _person(),
            _person(email="mew.wrong@example.com"),
        )
        assert result["allMatch"] is False
        assert "email differs" in result["summary"]
        email_field = next(item for item in result["fields"] if item["field"] == "email")
        assert email_field["status"] == "differs"
