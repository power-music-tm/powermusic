"""Seed realistic historical test records spanning 6 months ago to today.

Demonstrates:
1. User added 6 months ago, still active
2. User added 3 months ago, updated 2 weeks ago, currently active
3. User added last month, removed last week, currently in Archive
4. User added yesterday, still active
5. User added 2 weeks ago, archived yesterday
6. User added today, still active
7. User removed today, currently in Archive
8. Multi-event user across time (Add in Feb, Update in May, Remove in Aug)
9. Mixed request sources (Admin entry, Manager request, Automated email)
10. Pending requests in New Requests queue (today, yesterday, older)

Usage from backend/:
    PYTHONPATH=. .venv/bin/python seed_time_filter_test_data.py
    PYTHONPATH=. .venv/bin/python seed_time_filter_test_data.py --purge
"""

from __future__ import annotations

import argparse
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app import models
from app.database import SessionLocal
from app.manager_request_tags import (
    TAG_ALREADY_EXISTS,
    TAG_AUTO_MAIL,
    TAG_PARTNER_REQUEST,
    TAG_SENT_BY_ADMIN,
    TAG_VERIFIED,
)
from app.request_display import allocate_request_ids

TEST_DOMAIN = "apexfitness.test"


def _email(slug: str) -> str:
    return f"{slug}@{TEST_DOMAIN}"


def purge_test_data(db) -> int:
    rows = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.person_email.ilike(f"%@{TEST_DOMAIN}"))
        .all()
    )
    for r in rows:
        db.delete(r)
    db.flush()
    return len(rows)


def _create_record(
    db,
    *,
    person_first: str,
    person_last: str,
    person_email: str,
    person_location: str,
    action: str,
    status: str,
    outcome: Optional[str],
    received_at: datetime,
    handled_at: Optional[datetime],
    tags: List[str],
    manager_notes: Optional[str] = None,
    admin_notes: Optional[str] = None,
    manager_id: Optional[str] = None,
    admin_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    history_events: Optional[List[Dict[str, Any]]] = None,
    source_gmail_msg_id: Optional[str] = None,
    auto_mail_meta: Optional[Dict[str, Any]] = None,
    submitted_by: Optional[Dict[str, str]] = None,
) -> models.ManagerRequest:
    row_id = allocate_request_ids(db, 1)[0]

    intake_persons: Dict[str, Any] = {
        "partner": {
            "firstName": person_first,
            "lastName": person_last,
            "email": person_email,
            "location": person_location,
        }
    }

    if source_gmail_msg_id or TAG_AUTO_MAIL in tags:
        intake_persons["autoMail"] = {
            "firstName": person_first,
            "lastName": person_last,
            "email": person_email,
            "location": person_location,
        }
        if auto_mail_meta:
            intake_persons["autoMailMeta"] = auto_mail_meta

    if submitted_by:
        intake_persons["submittedBy"] = submitted_by

    if history_events:
        intake_persons["history"] = history_events

    row = models.ManagerRequest(
        id=row_id,
        received_at=received_at,
        handled_at=handled_at,
        manager_id=manager_id,
        handled_by_admin_id=admin_id,
        partner_id=partner_id,
        person_first_name=person_first,
        person_last_name=person_last,
        person_email=person_email,
        person_location=person_location,
        action=action,
        status=status,
        outcome=outcome,
        tags=tags,
        manager_notes=manager_notes,
        admin_notes=admin_notes,
        source_gmail_message_id=source_gmail_msg_id,
        intake_persons=intake_persons,
    )
    db.add(row)
    db.flush()
    return row


def seed_data() -> List[Dict[str, Any]]:
    db = SessionLocal()
    try:
        purged = purge_test_data(db)
        print(f"Purged {purged} previous test row(s).")

        # Find manager and admin users
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
        partner = (
            db.query(models.Partner)
            .order_by(models.Partner.created_at.asc())
            .first()
        )

        mid = str(manager.id) if manager else None
        aid = str(admin.id) if admin else None
        pid = str(partner.id) if partner else None
        mgr_name = f"{manager.first_name or ''} {manager.last_name or ''}".strip() or "Marcus Vance"
        admin_name = f"{admin.first_name or ''} {admin.last_name or ''}".strip() or "Andrea Taylor"

        now = datetime.now(timezone.utc)
        results = []

        # 1. User added 6 months ago, still active
        t_recv1 = now - timedelta(days=180)
        t_hand1 = now - timedelta(days=179)
        ev1 = [
            {
                "id": f"seed-1-mgr",
                "type": "manager_request",
                "at": t_recv1.isoformat(),
                "action": "Add",
                "title": f"Submitted by {mgr_name}",
                "detail": "New hire instructor intake",
                "managerName": mgr_name,
            },
            {
                "id": f"seed-1-hand",
                "type": "handled",
                "at": t_hand1.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Added and moved to active",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
        ]
        r1 = _create_record(
            db,
            person_first="Liam",
            person_last="Bennett",
            person_email=_email("liam.bennett"),
            person_location="Denver North",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=t_recv1,
            handled_at=t_hand1,
            tags=[TAG_PARTNER_REQUEST, TAG_VERIFIED],
            manager_id=mid,
            admin_id=aid,
            partner_id=pid,
            manager_notes="Senior yoga instructor onboarding",
            admin_notes="Approved and provisioned",
            history_events=ev1,
        )
        results.append({"case": "1. User added 6mo ago, still active", "row": r1})

        # 2. User added 3 months ago, updated 2 weeks ago, currently active
        t_recv2_old = now - timedelta(days=90)
        t_hand2_old = now - timedelta(days=89)
        t_recv2_upd = now - timedelta(days=14)
        t_hand2_upd = now - timedelta(days=13)
        ev2 = [
            {
                "id": f"seed-2-mgr-old",
                "type": "manager_request",
                "at": t_recv2_old.isoformat(),
                "action": "Add",
                "title": "Submitted by David Rodriguez",
                "detail": "Initial instructor hire",
                "managerName": "David Rodriguez",
            },
            {
                "id": f"seed-2-hand-old",
                "type": "handled",
                "at": t_hand2_old.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Added and moved to active",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
            {
                "id": f"seed-2-mgr-upd",
                "type": "manager_request",
                "at": t_recv2_upd.isoformat(),
                "action": "Add",
                "title": "Submitted by David Rodriguez",
                "detail": "Promoted to Lead Instructor, location Denver Central",
                "managerName": "David Rodriguez",
            },
            {
                "id": f"seed-2-hand-upd",
                "type": "handled",
                "at": t_hand2_upd.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Updated active record",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
        ]
        r2 = _create_record(
            db,
            person_first="Sophia",
            person_last="Ramirez",
            person_email=_email("sophia.ramirez"),
            person_location="Denver Central",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=t_recv2_upd,
            handled_at=t_hand2_upd,
            tags=[TAG_PARTNER_REQUEST, TAG_VERIFIED],
            manager_id=mid,
            admin_id=aid,
            partner_id=pid,
            manager_notes="Promoted to Lead Instructor, location Denver Central",
            admin_notes="Updated role and location",
            history_events=ev2,
        )
        results.append({"case": "2. User added 3mo ago, updated 2wk ago, currently active", "row": r2})

        # 3. User added last month, removed last week, currently in Archive
        t_recv3_add = now - timedelta(days=35)
        t_hand3_add = now - timedelta(days=34)
        t_recv3_rem = now - timedelta(days=7)
        t_hand3_rem = now - timedelta(days=6)
        ev3 = [
            {
                "id": f"seed-3-mgr-add",
                "type": "manager_request",
                "at": t_recv3_add.isoformat(),
                "action": "Add",
                "title": "Submitted by Sarah Jenkins",
                "detail": "Summer seasonal instructor",
                "managerName": "Sarah Jenkins",
            },
            {
                "id": f"seed-3-hand-add",
                "type": "handled",
                "at": t_hand3_add.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Added and moved to active",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
            {
                "id": f"seed-3-mgr-rem",
                "type": "manager_request",
                "at": t_recv3_rem.isoformat(),
                "action": "Remove",
                "title": "Submitted by Sarah Jenkins",
                "detail": "Relocating out of state",
                "managerName": "Sarah Jenkins",
            },
            {
                "id": f"seed-3-hand-rem",
                "type": "handled",
                "at": t_hand3_rem.isoformat(),
                "action": "Remove",
                "outcome": "Removed",
                "title": "Removed to archive",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
        ]
        r3 = _create_record(
            db,
            person_first="Ethan",
            person_last="Clark",
            person_email=_email("ethan.clark"),
            person_location="Boulder West",
            action="Remove",
            status="handled",
            outcome="Removed",
            received_at=t_recv3_rem,
            handled_at=t_hand3_rem,
            tags=[TAG_PARTNER_REQUEST, TAG_VERIFIED],
            manager_id=mid,
            admin_id=aid,
            partner_id=pid,
            manager_notes="Relocating out of state",
            admin_notes="Archived record",
            history_events=ev3,
        )
        results.append({"case": "3. User added last month, removed last week, in Archive", "row": r3})

        # 4. User added yesterday, still active
        t_recv4 = now - timedelta(days=1, hours=2)
        t_hand4 = now - timedelta(days=1, hours=1)
        ev4 = [
            {
                "id": f"seed-4-auto",
                "type": "auto_mail",
                "at": t_recv4.isoformat(),
                "action": "Add",
                "title": "Automated email: New Hire Notification",
                "detail": "From hr@apexfitness.co",
            },
            {
                "id": f"seed-4-hand",
                "type": "handled",
                "at": t_hand4.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Added and moved to active",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
        ]
        r4 = _create_record(
            db,
            person_first="Maya",
            person_last="Patel",
            person_email=_email("maya.patel"),
            person_location="Aurora South",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=t_recv4,
            handled_at=t_hand4,
            tags=[TAG_AUTO_MAIL, TAG_VERIFIED],
            source_gmail_msg_id="seed-gmail-4",
            auto_mail_meta={"fromEmail": "hr@apexfitness.co", "subject": "New Hire Notification"},
            admin_id=aid,
            partner_id=pid,
            admin_notes="Verified via HR email and added",
            history_events=ev4,
        )
        results.append({"case": "4. User added yesterday, still active", "row": r4})

        # 5. User added 2 weeks ago, archived yesterday
        t_recv5_add = now - timedelta(days=14)
        t_hand5_add = now - timedelta(days=13)
        t_recv5_rem = now - timedelta(days=1, hours=4)
        t_hand5_rem = now - timedelta(days=1, hours=2)
        ev5 = [
            {
                "id": f"seed-5-admin-add",
                "type": "admin_entry",
                "at": t_recv5_add.isoformat(),
                "action": "Add",
                "title": "Added directly by Admin",
                "detail": f"By {admin_name}",
            },
            {
                "id": f"seed-5-hand-add",
                "type": "handled",
                "at": t_hand5_add.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Added and moved to active",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
            {
                "id": f"seed-5-mgr-rem",
                "type": "manager_request",
                "at": t_recv5_rem.isoformat(),
                "action": "Remove",
                "title": "Submitted by Elena Rostova",
                "detail": "Contract ended early",
                "managerName": "Elena Rostova",
            },
            {
                "id": f"seed-5-hand-rem",
                "type": "handled",
                "at": t_hand5_rem.isoformat(),
                "action": "Remove",
                "outcome": "Removed",
                "title": "Removed to archive",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
        ]
        r5 = _create_record(
            db,
            person_first="Lucas",
            person_last="Wright",
            person_email=_email("lucas.wright"),
            person_location="Denver Tech Center",
            action="Remove",
            status="handled",
            outcome="Removed",
            received_at=t_recv5_rem,
            handled_at=t_hand5_rem,
            tags=[TAG_PARTNER_REQUEST, TAG_VERIFIED],
            manager_id=mid,
            admin_id=aid,
            partner_id=pid,
            manager_notes="Contract ended early",
            admin_notes="Archived per manager request",
            history_events=ev5,
        )
        results.append({"case": "5. User added 2wk ago, archived yesterday", "row": r5})

        # 6. User added today, still active
        t_recv6 = now - timedelta(hours=3)
        t_hand6 = now - timedelta(hours=2)
        ev6 = [
            {
                "id": f"seed-6-mgr",
                "type": "manager_request",
                "at": t_recv6.isoformat(),
                "action": "Add",
                "title": f"Submitted by {mgr_name}",
                "detail": "Morning shift instructor replacement",
                "managerName": mgr_name,
            },
            {
                "id": f"seed-6-hand",
                "type": "handled",
                "at": t_hand6.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Added and moved to active",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
        ]
        r6 = _create_record(
            db,
            person_first="Chloe",
            person_last="Simmons",
            person_email=_email("chloe.simmons"),
            person_location="Lakewood West",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=t_recv6,
            handled_at=t_hand6,
            tags=[TAG_PARTNER_REQUEST, TAG_VERIFIED],
            manager_id=mid,
            admin_id=aid,
            partner_id=pid,
            manager_notes="Morning shift instructor replacement",
            admin_notes="Onboarded and verified",
            history_events=ev6,
        )
        results.append({"case": "6. User added today, still active", "row": r6})

        # 7. User removed today, currently in Archive
        t_recv7_add = now - timedelta(days=60)
        t_hand7_add = now - timedelta(days=59)
        t_recv7_rem = now - timedelta(hours=4)
        t_hand7_rem = now - timedelta(hours=3)
        ev7 = [
            {
                "id": f"seed-7-mgr-add",
                "type": "manager_request",
                "at": t_recv7_add.isoformat(),
                "action": "Add",
                "title": "Submitted by Sarah Jenkins",
                "detail": "Full-time spin coach",
                "managerName": "Sarah Jenkins",
            },
            {
                "id": f"seed-7-hand-add",
                "type": "handled",
                "at": t_hand7_add.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Added and moved to active",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
            {
                "id": f"seed-7-mgr-rem",
                "type": "manager_request",
                "at": t_recv7_rem.isoformat(),
                "action": "Remove",
                "title": "Submitted by Sarah Jenkins",
                "detail": "Resignation effective today",
                "managerName": "Sarah Jenkins",
            },
            {
                "id": f"seed-7-hand-rem",
                "type": "handled",
                "at": t_hand7_rem.isoformat(),
                "action": "Remove",
                "outcome": "Removed",
                "title": "Removed to archive",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
        ]
        r7 = _create_record(
            db,
            person_first="Noah",
            person_last="Tremblay",
            person_email=_email("noah.tremblay"),
            person_location="Highlands Ranch",
            action="Remove",
            status="handled",
            outcome="Removed",
            received_at=t_recv7_rem,
            handled_at=t_hand7_rem,
            tags=[TAG_PARTNER_REQUEST, TAG_VERIFIED],
            manager_id=mid,
            admin_id=aid,
            partner_id=pid,
            manager_notes="Resignation effective today",
            admin_notes="Archived today",
            history_events=ev7,
        )
        results.append({"case": "7. User removed today, currently in Archive", "row": r7})

        # 8. Multi-event user across time (Add in Feb, Update in May, Remove in Aug)
        t_recv8_add = now - timedelta(days=190)
        t_hand8_add = now - timedelta(days=189)
        t_recv8_upd = now - timedelta(days=100)
        t_hand8_upd = now - timedelta(days=99)
        t_recv8_rem = now - timedelta(days=5)
        t_hand8_rem = now - timedelta(days=4)
        ev8 = [
            {
                "id": f"seed-8-add",
                "type": "manager_request",
                "at": t_recv8_add.isoformat(),
                "action": "Add",
                "title": f"Submitted by {mgr_name}",
                "detail": "Initial hire in Colorado Springs",
                "managerName": mgr_name,
            },
            {
                "id": f"seed-8-hand-add",
                "type": "handled",
                "at": t_hand8_add.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Added and moved to active",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
            {
                "id": f"seed-8-upd",
                "type": "manager_request",
                "at": t_recv8_upd.isoformat(),
                "action": "Add",
                "title": "Submitted by David Rodriguez",
                "detail": "Updated certifications and contact info",
                "managerName": "David Rodriguez",
            },
            {
                "id": f"seed-8-hand-upd",
                "type": "handled",
                "at": t_hand8_upd.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Updated active record",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
            {
                "id": f"seed-8-rem",
                "type": "manager_request",
                "at": t_recv8_rem.isoformat(),
                "action": "Remove",
                "title": "Submitted by Elena Rostova",
                "detail": "Transferred to partner network",
                "managerName": "Elena Rostova",
            },
            {
                "id": f"seed-8-hand-rem",
                "type": "handled",
                "at": t_hand8_rem.isoformat(),
                "action": "Remove",
                "outcome": "Removed",
                "title": "Removed to archive",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
        ]
        r8 = _create_record(
            db,
            person_first="Gabriel",
            person_last="Rivera",
            person_email=_email("gabriel.rivera"),
            person_location="Colorado Springs",
            action="Remove",
            status="handled",
            outcome="Removed",
            received_at=t_recv8_rem,
            handled_at=t_hand8_rem,
            tags=[TAG_PARTNER_REQUEST, TAG_VERIFIED],
            manager_id=mid,
            admin_id=aid,
            partner_id=pid,
            manager_notes="Transferred to partner network",
            admin_notes="Archived",
            history_events=ev8,
        )
        results.append({"case": "8. Multi-event user (Feb Add, May Upd, Aug Rem)", "row": r8})

        # 9. Additional active users from mixed sources
        t_recv9 = now - timedelta(days=45)
        t_hand9 = now - timedelta(days=44)
        ev9 = [
            {
                "id": f"seed-9-auto",
                "type": "auto_mail",
                "at": t_recv9.isoformat(),
                "action": "Add",
                "title": "Automated email intake",
                "detail": "From roster-sync@apexfitness.co",
            },
            {
                "id": f"seed-9-hand",
                "type": "handled",
                "at": t_hand9.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Added and moved to active",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
        ]
        r9 = _create_record(
            db,
            person_first="Isabella",
            person_last="Rossi",
            person_email=_email("isabella.rossi"),
            person_location="Fort Collins",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=t_recv9,
            handled_at=t_hand9,
            tags=[TAG_AUTO_MAIL, TAG_VERIFIED],
            source_gmail_msg_id="seed-gmail-9",
            auto_mail_meta={"fromEmail": "roster-sync@apexfitness.co", "subject": "Fort Collins Roster Addition"},
            admin_id=aid,
            partner_id=pid,
            admin_notes="Provisioned from automated roster sync",
            history_events=ev9,
        )
        results.append({"case": "9. Auto mail source, active", "row": r9})

        t_recv10 = now - timedelta(days=25)
        t_hand10 = now - timedelta(days=24)
        ev10 = [
            {
                "id": f"seed-10-admin",
                "type": "admin_entry",
                "at": t_recv10.isoformat(),
                "action": "Add",
                "title": f"Manual Admin onboarding by {admin_name}",
                "detail": "Direct onboarding",
            },
            {
                "id": f"seed-10-hand",
                "type": "handled",
                "at": t_hand10.isoformat(),
                "action": "Add",
                "outcome": "Added",
                "title": "Added and moved to active",
                "detail": f"By {admin_name}",
                "handledBy": admin_name,
            },
        ]
        r10 = _create_record(
            db,
            person_first="Julian",
            person_last="Foster",
            person_email=_email("julian.foster"),
            person_location="Denver Highlands",
            action="Add",
            status="handled",
            outcome="Added",
            received_at=t_recv10,
            handled_at=t_hand10,
            tags=[TAG_SENT_BY_ADMIN, TAG_VERIFIED],
            admin_id=aid,
            partner_id=pid,
            admin_notes="Direct onboarding by Admin",
            history_events=ev10,
        )
        results.append({"case": "10. Admin manual entry, active", "row": r10})

        # 11. Pending Requests in New Requests queue
        # Pending 1: Added today
        t_pend1 = now - timedelta(hours=1)
        r_p1 = _create_record(
            db,
            person_first="Zoe",
            person_last="Brooks",
            person_email=_email("zoe.brooks"),
            person_location="Denver Central",
            action="Add",
            status="new",
            outcome=None,
            received_at=t_pend1,
            handled_at=None,
            tags=[TAG_PARTNER_REQUEST],
            manager_id=mid,
            partner_id=pid,
            manager_notes="New instructor for Saturday class rotation",
            submitted_by={"firstName": mgr_name, "lastName": "", "email": "marcus@apexfitness.co", "club": "Apex Central"},
        )
        results.append({"case": "11. Pending Add from today", "row": r_p1})

        # Pending 2: Remove received yesterday via auto mail
        t_pend2 = now - timedelta(days=1, hours=5)
        r_p2 = _create_record(
            db,
            person_first="Alexander",
            person_last="Hayes",
            person_email=_email("alexander.hayes"),
            person_location="Boulder West",
            action="Remove",
            status="new",
            outcome=None,
            received_at=t_pend2,
            handled_at=None,
            tags=[TAG_AUTO_MAIL],
            source_gmail_msg_id="seed-gmail-pend-2",
            auto_mail_meta={"fromEmail": "hr@apexfitness.co", "subject": "Termination Notice: Alexander Hayes"},
            partner_id=pid,
            admin_notes="Awaiting confirmation",
        )
        results.append({"case": "12. Pending Remove from yesterday (auto mail)", "row": r_p2})

        # Pending 3: Add with duplicate alert received 5 days ago
        t_pend3 = now - timedelta(days=5)
        r_p3 = _create_record(
            db,
            person_first="Ava",
            person_last="Morales",
            person_email=_email("ava.morales"),
            person_location="Aurora South",
            action="Add",
            status="new",
            outcome=None,
            received_at=t_pend3,
            handled_at=None,
            tags=[TAG_PARTNER_REQUEST, TAG_ALREADY_EXISTS],
            manager_id=mid,
            partner_id=pid,
            manager_notes="Re-adding previously registered coach",
            submitted_by={"firstName": "David Rodriguez", "lastName": "", "email": "david@apexfitness.co", "club": "Aurora South"},
        )
        results.append({"case": "13. Pending Add with Duplicate tag (5d ago)", "row": r_p3})

        db.commit()
        return results
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--purge", action="store_true")
    args = parser.parse_args()

    if args.purge:
        db = SessionLocal()
        try:
            n = purge_test_data(db)
            db.commit()
            print(f"Purged {n} test row(s).")
        finally:
            db.close()
        return

    results = seed_data()
    print(f"\nSuccessfully seeded {len(results)} realistic test records across 6 months to today:\n")
    for item in results:
        r = item["row"]
        print(f"• {item['case']}")
        print(f"  ID:       {r.id}")
        print(f"  Person:   {r.person_first_name} {r.person_last_name} <{r.person_email}> ({r.person_location})")
        print(f"  Action:   {r.action} | Status: {r.status} | Outcome: {r.outcome}")
        print(f"  Received: {r.received_at.isoformat() if r.received_at else None}")
        print(f"  Handled:  {r.handled_at.isoformat() if r.handled_at else None}")
        print(f"  Tags:     {r.tags}")
        print()


if __name__ == "__main__":
    main()
