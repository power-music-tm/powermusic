import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy.orm import Session

from app import models, schemas
from app.api.routers.pilot1 import update_person
from app.database import SessionLocal
from app.intake_persons import get_lifecycle_history


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
        manager_notes="Please keep these manager notes",
        admin_notes="Initial admin note",
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
        adminNotes="Updated admin note\nwith line break",
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
    assert res["adminNotes"] == "Updated admin note\nwith line break"

    # Verify DB persistence
    db.refresh(req)
    assert req.person_first_name == "Anna"
    assert req.person_last_name == "Smith"
    assert req.person_email == "anna.smith@example.com"
    assert req.person_location == "Manchester"
    assert req.admin_notes == "Updated admin note\nwith line break"
    assert req.manager_notes == "Please keep these manager notes"
    assert req.intake_persons["partner"]["lastName"] == "Smith"
    assert req.intake_persons["partner"]["email"] == "anna.smith@example.com"
    assert req.intake_persons["partner"]["location"] == "Manchester"

    history = get_lifecycle_history(req)
    notes_events = [
        event for event in history
        if event.get("type") == "admin_notes_edited"
    ]
    assert notes_events
    assert notes_events[0].get("title") == "Admin notes edited"
    assert notes_events[0].get("detail") == "By Power Music Admin"
    assert notes_events[0].get("handledBy") == "Power Music Admin"

    # Verify identity preserved and no duplicate created
    end_count = db.query(models.ManagerRequest).count()
    assert start_count == end_count


def test_update_directory_person_admin_notes_unchanged_skips_history(db: Session):
    req_id = f"test-edit-notes-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    req = models.ManagerRequest(
        id=req_id,
        received_at=now,
        handled_at=now,
        status="handled",
        action="Add",
        person_first_name="Carl",
        person_last_name="Jones",
        person_email=f"carl-{uuid.uuid4().hex[:6]}@example.com",
        person_location="London",
        manager_notes="Manager only",
        admin_notes="Same note",
    )
    db.add(req)
    db.commit()

    res = update_person(
        person_id=req_id,
        payload=schemas.PersonUpdateIn(
            firstName="Carl",
            lastName="Jones",
            email=req.person_email,
            location="London",
            adminNotes="Same note",
        ),
        db=db,
        _admin=True,
    )

    db.refresh(req)
    assert res["adminNotes"] == "Same note"
    assert req.manager_notes == "Manager only"
    assert not any(event.get("type") == "admin_notes_edited" for event in get_lifecycle_history(req))


def test_update_directory_person_can_clear_admin_notes(db: Session):
    req_id = f"test-edit-clear-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    req = models.ManagerRequest(
        id=req_id,
        received_at=now,
        handled_at=now,
        status="handled",
        action="Add",
        person_first_name="Dana",
        person_last_name="Lee",
        person_email=f"dana-{uuid.uuid4().hex[:6]}@example.com",
        person_location="Leeds",
        manager_notes="Leave me alone",
        admin_notes="Will be cleared",
    )
    db.add(req)
    db.commit()

    res = update_person(
        person_id=req_id,
        payload=schemas.PersonUpdateIn(
            firstName="Dana",
            lastName="Lee",
            email=req.person_email,
            location="Leeds",
            adminNotes="",
        ),
        db=db,
        _admin=True,
    )

    db.refresh(req)
    assert res.get("adminNotes") in (None, "")
    assert req.admin_notes in (None, "")
    assert req.manager_notes == "Leave me alone"
    assert any(event.get("type") == "admin_notes_edited" for event in get_lifecycle_history(req))


def test_lifecycle_history_normalizes_personal_admin_attribution(db: Session):
    """Older rows that stored a personal admin name should display as Power Music Admin."""
    req_id = f"test-hist-norm-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    req = models.ManagerRequest(
        id=req_id,
        received_at=now,
        handled_at=now,
        status="handled",
        action="Add",
        person_first_name="Eve",
        person_last_name="Stone",
        person_email=f"eve-{uuid.uuid4().hex[:6]}@example.com",
        person_location="York",
        intake_persons={
            "history": [
                {
                    "id": f"{req_id}-admin-notes-old",
                    "type": "admin_notes_edited",
                    "at": now.isoformat(),
                    "title": "Admin Notes Edited",
                    "detail": "By Andrea None",
                    "handledBy": "Andrea None",
                },
                {
                    "id": f"{req_id}-handled",
                    "type": "handled",
                    "at": now.isoformat(),
                    "title": "Added and moved to active",
                    "detail": "By Andrea Nunn",
                    "handledBy": "Andrea Nunn",
                },
            ],
        },
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    history = get_lifecycle_history(req)
    assert history[0]["title"] == "Admin notes edited"
    assert history[0]["detail"] == "By Power Music Admin"
    assert history[0]["handledBy"] == "Power Music Admin"
    assert history[1]["detail"] == "By Power Music Admin"
    assert history[1]["handledBy"] == "Power Music Admin"
