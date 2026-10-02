"""Seed a demo New Request with auto mail + manager form + directory mismatch.

Run from backend/:
  PYTHONPATH=. .venv-mac/bin/python scripts/seed_diff_demo_request.py
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app import models
from app.database import SessionLocal
from app.manager_request_tags import TAG_AUTO_MAIL, TAG_PARTNER_REQUEST, TAG_VERIFIED
from app.request_display import allocate_request_ids
from app.request_match_summary import build_directory_match, build_intake_match


DEMO_EMAIL = "casey.differs@demo.powermusic.test"
DEMO_PENDING_ID_MARKER = "demo-diff-all-sources"
def _purge_demo_rows(db) -> None:
    rows = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.person_email == DEMO_EMAIL)
        .all()
    )
    for row in rows:
        db.delete(row)
    db.flush()


def seed_diff_demo_request() -> dict:
    db = SessionLocal()
    try:
        _purge_demo_rows(db)

        manager = (
            db.query(models.PowermusicUser)
            .filter(models.PowermusicUser.role == "manager")
            .order_by(models.PowermusicUser.email.asc())
            .first()
        )
        admin = (
            db.query(models.PowermusicUser)
            .filter(models.PowermusicUser.role == "admin")
            .order_by(models.PowermusicUser.email.asc())
            .first()
        )

        now = datetime.now(timezone.utc)
        directory_id, pending_id = allocate_request_ids(db, 2)

        directory_row = models.ManagerRequest(
            id=directory_id,
            received_at=now - timedelta(days=40),
            handled_at=now - timedelta(days=39),
            manager_id=manager.id if manager else None,
            handled_by_admin_id=admin.id if admin else None,
            person_first_name="Casey",
            person_last_name="Ledger",
            person_email=DEMO_EMAIL,
            person_location="London",
            action="Add",
            manager_notes=None,
            admin_notes="Demo directory seed",
            tags=[TAG_PARTNER_REQUEST, TAG_VERIFIED],
            status="handled",
            outcome="Added",
            intake_persons={
                "partner": {
                    "firstName": "Casey",
                    "lastName": "Ledger",
                    "email": DEMO_EMAIL,
                    "location": "London",
                }
            },
        )
        db.add(directory_row)
        db.flush()

        pending_row = models.ManagerRequest(
            id=pending_id,
            received_at=now - timedelta(minutes=12),
            handled_at=None,
            manager_id=manager.id if manager else None,
            handled_by_admin_id=None,
            # Display person prefers manager/partner snapshot
            person_first_name="Casey",
            person_last_name="Manager",
            person_email=DEMO_EMAIL,
            person_location="Manchester",
            action="Add",
            manager_notes=None,
            admin_notes=None,
            tags=[TAG_VERIFIED, TAG_PARTNER_REQUEST, TAG_AUTO_MAIL],
            status="new",
            outcome=None,
            source_gmail_message_id=f"{DEMO_PENDING_ID_MARKER}-{pending_id}",
            intake_persons={
                "partner": {
                    "firstName": "Casey",
                    "lastName": "Manager",
                    "email": DEMO_EMAIL,
                    "location": "Manchester",
                },
                "autoMail": {
                    "firstName": "Casey",
                    "lastName": "Auto",
                    "email": DEMO_EMAIL,
                    "location": "Birmingham",
                },
                "autoMailMeta": {
                    "fromEmail": "em@myptzone.co",
                    "inboxEmail": "ogs529@gmail.com",
                    "subject": "New PureGym user",
                    "receivedAt": (now - timedelta(minutes=12)).isoformat(),
                    "details": "Automated PureGym email — Add\nSubject: New PureGym user",
                },
            },
        )
        db.add(pending_row)
        db.commit()
        db.refresh(pending_row)
        db.refresh(directory_row)

        intake = build_intake_match(pending_row)
        directory = build_directory_match(pending_row, directory_row)

        return {
            "pendingId": pending_id,
            "directoryId": directory_id,
            "email": DEMO_EMAIL,
            "managerEmail": manager.email if manager else None,
            "intakeMatch": intake,
            "directoryMatch": {
                "allMatch": directory.get("allMatch") if directory else None,
                "summary": directory.get("summary") if directory else None,
                "directoryName": directory.get("directoryName") if directory else None,
            },
        }
    finally:
        db.close()


if __name__ == "__main__":
    result = seed_diff_demo_request()
    print("Seeded demo multi-source diff request:")
    for key, value in result.items():
        print(f"  {key}: {value}")
