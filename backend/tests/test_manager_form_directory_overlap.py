"""Manager form Check Directory overlap (match-candidates only; not same_person identity)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.directory_person_match import manager_form_directory_overlap_reasons
from app.person_match import same_person_gll, same_person_for_partner
from app import schemas


def _row(**kwargs):
    defaults = {
        "person_first_name": "Josie",
        "person_last_name": "Miller",
        "person_email": "mjose101@yahoo.co.uk",
        "person_location": "London Gym",
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


class TestManagerFormDirectoryOverlap:
    @pytest.mark.parametrize(
        "form,expect_reason",
        [
            ({"first": "josie", "last": "miller", "email": "", "location": ""}, "Name"),
            ({"first": "josie", "last": "", "email": "mjose101@yahoo.co.uk", "location": ""}, "Email"),
            ({"first": "josie", "last": "", "email": "", "location": "london gym"}, "First name + location"),
            ({"first": "", "last": "miller", "email": "mjose101@yahoo.co.uk", "location": ""}, "Email"),
            ({"first": "", "last": "miller", "email": "", "location": "london gym"}, "Last name + location"),
            (
                {"first": "", "last": "", "email": "mjose101@yahoo.co.uk", "location": "london gym"},
                "Email + location",
            ),
        ],
    )
    def test_two_field_pairs_warn(self, form, expect_reason):
        row = _row()
        reasons = manager_form_directory_overlap_reasons(row=row, **form)
        assert expect_reason in reasons

    @pytest.mark.parametrize(
        "form",
        [
            {"first": "josie", "last": "", "email": "", "location": ""},
            {"first": "", "last": "miller", "email": "", "location": ""},
            {"first": "", "last": "", "email": "mjose101@yahoo.co.uk", "location": ""},
            {"first": "", "last": "", "email": "", "location": "London Gym"},
            {"first": "wrong", "last": "miller", "email": "", "location": ""},
        ],
    )
    def test_single_field_or_mismatch_does_not_warn(self, form):
        row = _row()
        assert manager_form_directory_overlap_reasons(row=row, **form) == set()

    def test_email_alone_does_not_warn(self):
        row = _row()
        assert (
            manager_form_directory_overlap_reasons(
                email="mjose101@yahoo.co.uk",
                first="",
                last="",
                location="",
                row=row,
            )
            == set()
        )

    def test_overlap_without_same_person_gll_identity(self):
        """GLL name-only warns for manager form but is not same_person_gll identity."""
        row = _row()
        form_probe = schemas.PersonInfo(
            firstName="josie",
            lastName="miller",
            email="",
            location="",
        )
        row_model = schemas.PersonInfo.model_construct(
            firstName=row.person_first_name,
            lastName=row.person_last_name,
            email=row.person_email,
            location=row.person_location,
        )
        reasons = manager_form_directory_overlap_reasons(
            email="",
            first="josie",
            last="miller",
            location="",
            row=row,
        )
        assert "Name" in reasons
        assert not same_person_gll(form_probe, row_model)
        assert not same_person_for_partner(form_probe, row_model, is_gll=True)
