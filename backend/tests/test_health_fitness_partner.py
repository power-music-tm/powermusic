import pytest
from pydantic import ValidationError

from app import schemas


def test_health_fitness_submitted_by_optional_fields():
    # Health Fitness submittedBy only requires firstName and lastName
    sub = schemas.SubmittedBy(firstName="John", lastName="Doe")
    assert sub.firstName == "John"
    assert sub.lastName == "Doe"
    assert sub.email is None
    assert sub.club is None


def test_puregym_submitted_by_full_fields():
    # PureGym submittedBy includes email and club
    sub = schemas.SubmittedBy(
        firstName="Alice",
        lastName="Smith",
        email="alice@puregym.com",
        club="London Central",
    )
    assert sub.firstName == "Alice"
    assert sub.lastName == "Smith"
    assert sub.email == "alice@puregym.com"
    assert sub.club == "London Central"


def test_request_in_health_fitness_payload():
    # Health Fitness request payload with submittedBy having only first/last name
    req = schemas.RequestIn(
        submittedBy={"firstName": "John", "lastName": "Doe"},
        person={
            "firstName": "UserFirst",
            "lastName": "UserLast",
            "email": "user@healthfitness.com",
            "location": "HQ Client",
        },
        action="Add",
    )
    assert req.submittedBy.firstName == "John"
    assert req.submittedBy.lastName == "Doe"
    assert req.person.firstName == "UserFirst"
    assert req.person.location == "HQ Client"


def test_request_level_director_persistence():
    from app import models
    from app.user_display import resolve_manager_fields, resolve_manager_name
    from app.intake_persons import set_submitted_by_attribution

    req1 = models.ManagerRequest(id="req-101", manager_id="mgr-samantha", partner_id="partner-hf")
    set_submitted_by_attribution(req1, first_name="Steve", last_name="Com")

    req2 = models.ManagerRequest(id="req-102", manager_id="mgr-samantha", partner_id="partner-hf")
    set_submitted_by_attribution(req2, first_name="Sarah", last_name="Khan")

    fields1 = resolve_manager_fields(req1)
    name1 = resolve_manager_name(req1)
    fields2 = resolve_manager_fields(req2)
    name2 = resolve_manager_name(req2)

    assert fields1["firstName"] == "Steve"
    assert fields1["lastName"] == "Com"
    assert name1 == "Steve Com"

    assert fields2["firstName"] == "Sarah"
    assert fields2["lastName"] == "Khan"
    assert name2 == "Sarah Khan"

