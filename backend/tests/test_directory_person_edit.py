import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy.orm import Session

from app import models, schemas
from app.api.routers.pilot1 import update_person
from app.database import SessionLocal


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
        session.rollback()
    finally:
        session.close()


def test_update_directory_person_in_place(db: Session):
    # Create an initial manager request record
    req_id = f"test-edit-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    req = models.ManagerRequest(
        id=req_id,
        received_at=now,
        handled_at=now,
        status="handled",
        action="Add",
        person_first_name="Anna",
        person_last_name="Taylor",
        person_email="anna.taylor@example.com",
        person_location="London",
        intake_persons={
            "partner": {
                "firstName": "Anna",
                "lastName": "Taylor",
                "email": "anna.taylor@example.com",
                "location": "London",
            }
        },
    )
    db.add(req)
    db.commit()

    start_count = db.query(models.ManagerRequest).count()

    # Update person record details
    update_payload = schemas.PersonUpdateIn(
        firstName="Anna",
        lastName="Smith",
        email="anna.smith@example.com",
        location="Manchester",
    )

    res = update_person(
        person_id=req_id,
        payload=update_payload,
        db=db,
        _admin=True,
    )

    # Verify response
    assert res["id"] == req_id
    assert res["firstName"] == "Anna"
    assert res["lastName"] == "Smith"
    assert res["email"] == "anna.smith@example.com"
    assert res["location"] == "Manchester"

    # Verify DB persistence
    db.refresh(req)
    assert req.person_first_name == "Anna"
    assert req.person_last_name == "Smith"
    assert req.person_email == "anna.smith@example.com"
    assert req.person_location == "Manchester"
    assert req.intake_persons["partner"]["lastName"] == "Smith"
    assert req.intake_persons["partner"]["email"] == "anna.smith@example.com"
    assert req.intake_persons["partner"]["location"] == "Manchester"

    # Verify identity preserved and no duplicate created
    end_count = db.query(models.ManagerRequest).count()
    assert start_count == end_count
