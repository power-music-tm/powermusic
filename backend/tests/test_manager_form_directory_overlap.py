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


class TestManagerFormDirectoryOverlapNonGll:
    """Non-GLL: exact email alone warns; else Name+Location (Name = first+last)."""

    @pytest.mark.parametrize(
        "form,expect_reason",
        [
            (
                {"first": "josie", "last": "miller", "email": "mjose101@yahoo.co.uk", "location": ""},
                "Name",
            ),
            (
                {"first": "josie", "last": "miller", "email": "", "location": "london gym"},
                "Name",
            ),
            (
                {"first": "", "last": "", "email": "mjose101@yahoo.co.uk", "location": "london gym"},
                "Email",
            ),
            (
                {"first": "", "last": "", "email": "mjose101@yahoo.co.uk", "location": ""},
                "Email",
            ),
            (
                {
                    "first": "josie",
                    "last": "miller",
                    "email": "mjose101@yahoo.co.uk",
                    "location": "london gym",
                },
                "Name",
            ),
        ],
    )
    def test_entity_pairs_warn(self, form, expect_reason):
        row = _row()
        reasons = manager_form_directory_overlap_reasons(row=row, is_gll=False, **form)
        assert expect_reason in reasons

    @pytest.mark.parametrize(
        "form",
        [
            # Name alone
            {"first": "josie", "last": "miller", "email": "", "location": ""},
            # Partial name + location only (incomplete Name entity, no email)
            {"first": "josie", "last": "", "email": "", "location": "london gym"},
            {"first": "", "last": "miller", "email": "", "location": "london gym"},
            # Singles
            {"first": "josie", "last": "", "email": "", "location": ""},
            {"first": "", "last": "miller", "email": "", "location": ""},
            {"first": "", "last": "", "email": "", "location": "London Gym"},
            {"first": "wrong", "last": "miller", "email": "", "location": ""},
        ],
    )
    def test_incomplete_entity_pairs_do_not_warn(self, form):
        row = _row()
        assert manager_form_directory_overlap_reasons(row=row, is_gll=False, **form) == set()


class TestManagerFormDirectoryOverlapGll:
    """GLL: email alone; first+last; first+location. Never last+location alone."""

    @pytest.mark.parametrize(
        "form,expect_reason",
        [
            ({"first": "josie", "last": "miller", "email": "", "location": ""}, "Name"),
            ({"first": "josie", "last": "", "email": "", "location": "london gym"}, "Location"),
            ({"first": "josie", "last": "", "email": "mjose101@yahoo.co.uk", "location": ""}, "Email"),
            ({"first": "", "last": "miller", "email": "mjose101@yahoo.co.uk", "location": ""}, "Email"),
            ({"first": "", "last": "", "email": "mjose101@yahoo.co.uk", "location": ""}, "Email"),
        ],
    )
    def test_two_field_pairs_warn(self, form, expect_reason):
        row = _row()
        reasons = manager_form_directory_overlap_reasons(row=row, is_gll=True, **form)
        assert expect_reason in reasons

    def test_last_plus_location_alone_does_not_warn(self):
        row = _row()
        reasons = manager_form_directory_overlap_reasons(
            email="",
            first="",
            last="miller",
            location="london gym",
            row=row,
            is_gll=True,
        )
        assert reasons == set()

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
            is_gll=True,
        )
        assert "Name" in reasons
        assert not same_person_gll(form_probe, row_model)
        assert not same_person_for_partner(form_probe, row_model, is_gll=True)
