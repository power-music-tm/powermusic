import uuid
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.api.routers.pilot1 import archive_person, restore_person, get_people, get_archived_people
from app.directory_person_match import duplicate_tags_for_person
from app.manager_request_tags import TAG_ALREADY_EXISTS
from app.database import SessionLocal


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        session.query(models.ManagerRequest).filter(models.ManagerRequest.id.like("test-arch-%")).delete(synchronize_session=False)
        session.commit()
        yield session
        session.rollback()
    finally:
        session.close()


def test_archive_and_restore_person(db: Session):
    uid = uuid.uuid4().hex[:8]
    unique_first = "Janeten"
    unique_last = "Doetwenty"
    unique_email = f"archive.test.{uid}@example.com"
    unique_location = "Chicago"
    req_id = f"test-arch-{uid}"
    now = datetime.now(timezone.utc)
    
    req = models.ManagerRequest(
        id=req_id,
        received_at=now,
        handled_at=now,
        status="handled",
        outcome="Added",
        action="Add",
        person_first_name=unique_first,
        person_last_name=unique_last,
        person_email=unique_email,
        person_location=unique_location,
        intake_persons={
            "partner": {
                "firstName": unique_first,
                "lastName": unique_last,
                "email": unique_email,
                "location": unique_location,
            }
        },
    )
    db.add(req)
    db.commit()

    # 1. Verify active record appears in active directory
    active_people = get_people(db=db, _admin=True)
    active_ids = [p["id"] for p in active_people]
    assert req_id in active_ids

    # Verify duplicate detection triggers for active record
    candidate = schemas.PersonInfo(
        firstName=unique_first,
        lastName=unique_last,
        email=unique_email,
        location=unique_location,
    )
    tags = duplicate_tags_for_person(db, candidate, action="Add")
    assert TAG_ALREADY_EXISTS in tags

    # 2. Archive person
    archived_res = archive_person(person_id=req_id, db=db, _admin=True)
    assert archived_res["id"] == req_id
    assert archived_res["archivedAt"] is not None

    # Verify record excluded from active directory
    active_people_after = get_people(db=db, _admin=True)
    active_ids_after = [p["id"] for p in active_people_after]
    assert req_id not in active_ids_after

    # Verify record appears in archived directory
    archived_people = get_archived_people(db=db, _admin=True)
    archived_ids = [p["id"] for p in archived_people]
    assert req_id in archived_ids

    # 3. CRITICAL: Verify archived record does NOT trigger duplicate flag on incoming request
    tags_after_archive = duplicate_tags_for_person(db, candidate, action="Add")
    assert TAG_ALREADY_EXISTS not in tags_after_archive

    # 4. Restore person
    restored_res = restore_person(person_id=req_id, db=db, _admin=True)
    assert restored_res["id"] == req_id
    assert restored_res["archivedAt"] is None

    # Verify record reappears in active directory
    active_people_restored = get_people(db=db, _admin=True)
    active_ids_restored = [p["id"] for p in active_people_restored]
    assert req_id in active_ids_restored

    # Verify record removed from archived directory
    archived_people_restored = get_archived_people(db=db, _admin=True)
    archived_ids_restored = [p["id"] for p in archived_people_restored]
    assert req_id not in archived_ids_restored

    # Verify duplicate conflict detection triggers again after restore
    tags_after_restore = duplicate_tags_for_person(db, candidate, action="Add")
    assert TAG_ALREADY_EXISTS in tags_after_restore


def test_partner_isolation_for_archive_restore(db: Session):
    uid = uuid.uuid4().hex[:8]
    req_id = f"test-arch-p1-{uid}"
    now = datetime.now(timezone.utc)

    # Ensure partner record exists in DB
    partner_id = f"test-partner-alpha-{uid}"
    p_obj = db.query(models.Partner).filter(models.Partner.id == partner_id).first()
    if not p_obj:
        p_obj = models.Partner(id=partner_id, name=f"Partner Alpha {uid}", created_at=now, updated_at=now)
        db.add(p_obj)
        db.commit()

    req = models.ManagerRequest(
        id=req_id,
        received_at=now,
        handled_at=now,
        status="handled",
        outcome="Added",
        action="Add",
        person_first_name="Alice",
        person_last_name="Smith",
        person_email=f"alice.{uid}@example.com",
        person_location="London",
        partner_id=partner_id,
    )
    db.add(req)
    db.commit()

    # Query with matching partner_id returns record
    p_people = get_people(partner_id=partner_id, db=db, _admin=True)
    assert req_id in [p["id"] for p in p_people]

    # Query with another partner_id excludes record
    other_partner = f"test-partner-beta-{uid}"
    p_beta = db.query(models.Partner).filter(models.Partner.id == other_partner).first()
    if not p_beta:
        p_beta = models.Partner(id=other_partner, name=f"Partner Beta {uid}", created_at=now, updated_at=now)
        db.add(p_beta)
        db.commit()

    other_people = get_people(partner_id=other_partner, db=db, _admin=True)
    assert req_id not in [p["id"] for p in other_people]

    # Attempting to archive under wrong partner_id raises 404
    with pytest.raises(HTTPException) as exc_info:
        archive_person(person_id=req_id, partner_id=other_partner, db=db, _admin=True)
    assert exc_info.value.status_code == 404

    # Archive under correct partner_id succeeds
    archived_res = archive_person(person_id=req_id, partner_id=partner_id, db=db, _admin=True)
    assert archived_res["id"] == req_id

    # Attempting to restore under wrong partner_id raises 404
    with pytest.raises(HTTPException) as exc_info:
        restore_person(person_id=req_id, partner_id=other_partner, db=db, _admin=True)
    assert exc_info.value.status_code == 404

    # Restore under correct partner_id succeeds
    restored_res = restore_person(person_id=req_id, partner_id=partner_id, db=db, _admin=True)
    assert restored_res["id"] == req_id
