import pytest
from app import schemas, models
from app.manager_request_serialize import request_to_api_dict, directory_person_to_api_dict


def test_pydantic_schemas_health_fitness_fields():
    info = schemas.PersonInfo(
        firstName="John",
        lastName="Doe",
        email="john@healthfitness.com",
        location="HQ Client",
    )
    assert info.firstName == "John"
    assert info.lastName == "Doe"
    assert info.email == "john@healthfitness.com"
    assert info.location == "HQ Client"

    update_in = schemas.PersonUpdateIn(
        firstName="John",
        lastName="Doe",
        email="john@healthfitness.com",
        location="North Client",
    )
    assert update_in.location == "North Client"


def test_model_and_serialization_isolation():
    # PureGym request (location field represents location)
    puregym_req = models.ManagerRequest(
        id="req-puregym-001",
        person_first_name="Jane",
        person_last_name="Smith",
        person_email="jane@puregym.com",
        person_location="Manchester",
        partner_id="partner-001",
    )

    puregym_api = request_to_api_dict(puregym_req)
    assert puregym_api["person"]["location"] == "Manchester"

    # Health Fitness request (location field represents client)
    healthfitness_req = models.ManagerRequest(
        id="req-healthfitness-001",
        person_first_name="Alice",
        person_last_name="Wong",
        person_email="alice@healthfitness.com",
        person_location="Central Ward Client",
        partner_id="partner-003",
    )

    healthfitness_api = request_to_api_dict(healthfitness_req)
    assert healthfitness_api["person"]["location"] == "Central Ward Client"

    dir_api = directory_person_to_api_dict(healthfitness_req)
    assert dir_api["location"] == "Central Ward Client"
