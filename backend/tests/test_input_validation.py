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


def test_normalize_person_name_accepts_digits_and_symbols():
    assert normalize_person_name("John2", field_name="User First Name") == "John2"
    assert normalize_person_name("Rock & Roll", field_name="User First Name") == "Rock & Roll"
    assert normalize_person_name("Producer #1", field_name="User First Name") == "Producer #1"


def test_normalize_person_name_accepts_unicode_hyphen():
    assert normalize_person_name("Marie-Claire", field_name="User First Name") == "Marie-Claire"


def test_normalize_roster_person_name_rejects_short_values():
    with pytest.raises(ValueError, match="at least 2 characters"):
        normalize_roster_person_name("r", field_name="User First Name")


def test_normalize_roster_person_name_accepts_unicode_letters():
    assert normalize_roster_person_name("José", field_name="User First Name") == "José"


def test_normalize_roster_person_name_accepts_spaces_hyphens_apostrophes_and_symbols():
    assert (
        normalize_roster_person_name("Anna Lisa", field_name="User First Name")
        == "Anna Lisa"
    )
    assert (
        normalize_roster_person_name("Van Der Berg", field_name="User Last Name")
        == "Van Der Berg"
    )
    assert (
        normalize_roster_person_name("Anna-Lisa", field_name="User First Name")
        == "Anna-Lisa"
    )
    assert (
        normalize_roster_person_name("O'Neil", field_name="User First Name")
        == "O'Neil"
    )
    assert (
        normalize_roster_person_name("Smith-Jones", field_name="User Last Name")
        == "Smith-Jones"
    )
    assert (
        normalize_roster_person_name("Smith'Ogon", field_name="User Last Name")
        == "Smith'Ogon"
    )
    assert (
        normalize_roster_person_name("Mary-Jane O'Neil", field_name="User First Name")
        == "Mary-Jane O'Neil"
    )
    assert (
        normalize_roster_person_name("Rock & Roll", field_name="User First Name")
        == "Rock & Roll"
    )
    assert (
        normalize_roster_person_name("AC/DC", field_name="User Last Name")
        == "AC/DC"
    )
    assert (
        normalize_roster_person_name("Name (Remix) + Version 2", field_name="User First Name")
        == "Name (Remix) + Version 2"
    )


def test_normalize_roster_person_name_accepts_digits_and_symbols():
    assert normalize_roster_person_name("John2", field_name="User First Name") == "John2"
    assert (
        normalize_roster_person_name("Smith@Jones", field_name="User Last Name")
        == "Smith@Jones"
    )
    assert (
        normalize_roster_person_name("Artist $100", field_name="User First Name")
        == "Artist $100"
    )


def test_normalize_roster_person_location_accepts_multiword_digits_and_symbols():
    assert (
        normalize_roster_person_location(
            "Waltham Forest Feel Good Centre", field_name="User Location"
        )
        == "Waltham Forest Feel Good Centre"
    )
    assert (
        normalize_roster_person_location("Centre 2", field_name="User Location")
        == "Centre 2"
    )
    assert (
        normalize_roster_person_location("North-West Centre", field_name="User Location")
        == "North-West Centre"
    )
    assert (
        normalize_roster_person_location("R&B / Hip-Hop", field_name="User Location")
        == "R&B / Hip-Hop"
    )


def test_person_info_accepts_multiword_roster_names():
    person = schemas.PersonInfo(
        firstName="Anna Lisa",
        lastName="Van Der Berg",
        email="user@example.com",
        location="Donyngs Leisure Centre",
    )
    assert person.firstName == "Anna Lisa"
    assert person.lastName == "Van Der Berg"
    assert person.location == "Donyngs Leisure Centre"


def test_person_update_in_accepts_apostrophe_in_last_name():
    payload = schemas.PersonUpdateIn(
        firstName="Anna",
        lastName="Smith'Ogon",
        email="user@example.com",
        location="London Gym",
    )
    assert payload.lastName == "Smith'Ogon"


def test_person_info_accepts_special_characters():
    person = schemas.PersonInfo(
        firstName="Rock & Roll",
        lastName="AC/DC",
        email="user@example.com",
        location="Studio #1 (Main)",
    )
    assert person.firstName == "Rock & Roll"
    assert person.lastName == "AC/DC"
    assert person.location == "Studio #1 (Main)"


def test_normalize_roster_person_location_rejects_short_values():
    with pytest.raises(ValueError, match="at least 2 characters"):
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


def test_person_info_rejects_html_in_name():
    with pytest.raises(ValidationError):
        schemas.PersonInfo(
            firstName="<script>x</script>",
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
