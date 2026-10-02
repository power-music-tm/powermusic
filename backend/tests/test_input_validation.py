import pytest
from pydantic import ValidationError

from app import schemas
from app.input_validation import (
    normalize_email,
    normalize_person_name,
    normalize_person_notes,
    normalize_roster_person_location,
    normalize_roster_person_name,
)


def test_normalize_person_name_rejects_html():
    with pytest.raises(ValueError, match="HTML"):
        normalize_person_name("<script>x</script>", field_name="User First Name")


def test_normalize_person_name_rejects_digits():
    with pytest.raises(ValueError, match="letters"):
        normalize_person_name("John2", field_name="User First Name")


def test_normalize_person_name_accepts_unicode_hyphen():
    assert normalize_person_name("Marie-Claire", field_name="User First Name") == "Marie-Claire"


def test_normalize_roster_person_name_rejects_numbers_and_short_values():
    with pytest.raises(ValueError, match="letters only"):
        normalize_roster_person_name("John2", field_name="User First Name")
    with pytest.raises(ValueError, match="letters only"):
        normalize_roster_person_name("r", field_name="User First Name")


def test_normalize_roster_person_name_accepts_unicode_letters():
    assert normalize_roster_person_name("José", field_name="User First Name") == "José"


def test_normalize_roster_person_location_rejects_symbols_and_numbers():
    with pytest.raises(ValueError, match="letters and spaces only"):
        normalize_roster_person_location("tr133133_", field_name="User Location")
    with pytest.raises(ValueError, match="letters and spaces only"):
        normalize_roster_person_location("A", field_name="User Location")


def test_normalize_roster_person_location_accepts_spaces():
    assert (
        normalize_roster_person_location("Pure Gym London", field_name="User Location")
        == "Pure Gym London"
    )


def test_normalize_person_notes_rejects_html():
    with pytest.raises(ValueError, match="HTML"):
        normalize_person_notes("<img src=x>", field_name="notes")


def test_normalize_email_lowercases():
    assert normalize_email("Test@Example.COM") == "test@example.com"


def test_person_info_rejects_invalid_name():
    with pytest.raises(ValidationError):
        schemas.PersonInfo(
            firstName="123",
            lastName="Smith",
            email="user@example.com",
            location="London Gym",
        )


def test_person_info_rejects_single_letter_name():
    with pytest.raises(ValidationError):
        schemas.PersonInfo(
            firstName="r",
            lastName="Smith",
            email="user@example.com",
            location="London",
        )


def test_manager_batch_rejects_duplicate_emails():
    with pytest.raises(ValidationError, match="different email"):
        schemas.ManagerBatchRequestIn(
            submittedBy={
                "firstName": "Alex",
                "lastName": "Manager",
                "email": "manager@example.com",
                "club": "PureGym London",
            },
            people=[
                {
                    "firstName": "Sam",
                    "lastName": "One",
                    "email": "dup@example.com",
                    "location": "London",
                },
                {
                    "firstName": "Pat",
                    "lastName": "Two",
                    "email": "dup@example.com",
                    "location": "Manchester",
                },
            ],
            action="Add",
        )
