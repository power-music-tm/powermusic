"""Seed demos for intake combinations: resends, diffs, all tags, separate rows.

Emails use *@demo.powermusic.test so they are easy to spot and purge.

Run from backend/:
  PYTHONPATH=. .venv/bin/python scripts/seed_intake_history_demos.py
  PYTHONPATH=. .venv/bin/python scripts/seed_intake_history_demos.py --purge
"""

from __future__ import annotations

import argparse
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from app import models, schemas
from app.database import SessionLocal
from app.intake_persons import get_intake_events
from app.manager_request_intake import (
    intake_automated_email_request,
    intake_manager_submission,
)
from app.manager_request_tags import TAG_VERIFIED
from app.request_display import allocate_request_ids


DEMO_DOMAIN = "demo.powermusic.test"
DEMO_PREFIX = "combo."


def _email(slug: str) -> str:
    return f"{DEMO_PREFIX}{slug}@{DEMO_DOMAIN}"


def _person(email: str, first: str, last: str, location: str) -> schemas.PersonInfo:
    return schemas.PersonInfo(
        firstName=first,
        lastName=last,
        email=email,
        location=location,
    )


def _admin(name: str) -> schemas.SubmittedBy:
    return schemas.SubmittedBy(firstName=name, lastName="", email="", club="Manual entry")


def purge_demo_rows(db) -> int:
    rows = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.person_email.ilike(f"%@{DEMO_DOMAIN}"))
        .all()
    )
    extra = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.source_gmail_message_id.ilike("demo-combo-%"))
        .all()
    )
    seen = {r.id for r in rows}
    for row in extra:
        if row.id not in seen:
            rows.append(row)
            seen.add(row.id)
    for row in rows:
        db.delete(row)
    db.flush()
    return len(rows)


def _directory(
    db,
    *,
    person: schemas.PersonInfo,
    manager_id: str | None,
    admin_id: str | None,
    when: datetime,
) -> models.ManagerRequest:
    row_id = allocate_request_ids(db, 1)[0]
    row = models.ManagerRequest(
        id=row_id,
        received_at=when - timedelta(days=45),
        handled_at=when - timedelta(days=44),
        manager_id=manager_id,
        handled_by_admin_id=admin_id,
        person_first_name=person.firstName,
        person_last_name=person.lastName,
        person_email=person.email,
        person_location=person.location,
        action="Add",
        admin_notes="Demo directory seed",
        tags=[TAG_VERIFIED],
        status="handled",
        outcome="Added",
        intake_persons={
            "partner": {
                "firstName": person.firstName,
                "lastName": person.lastName,
                "email": person.email,
                "location": person.location,
            }
        },
    )
    db.add(row)
    db.flush()
    return row


def _result(label: str, row: models.ManagerRequest, hint: str) -> Dict[str, Any]:
    return {
        "label": label,
        "id": row.id,
        "email": row.person_email,
        "action": row.action,
        "events": len(get_intake_events(row)),
        "tags": list(row.tags or []),
        "hint": hint,
    }


def _stamp_latest_event(
    row: models.ManagerRequest,
    *,
    event_type: str,
    when: datetime,
) -> None:
    """Backdate the newest event of a given type (seed demos only)."""
    from app.intake_persons import get_intake_persons

    current = dict(get_intake_persons(row))
    events = list(current.get("events") or [])
    for event in reversed(events):
        if isinstance(event, dict) and event.get("type") == event_type:
            event["at"] = when.astimezone(timezone.utc).isoformat()
            break
    current["events"] = events
    row.intake_persons = current


def seed_demos() -> List[Dict[str, Any]]:
    db = SessionLocal()
    out: List[Dict[str, Any]] = []
    try:
        purged = purge_demo_rows(db)
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
        if manager is None:
            raise RuntimeError("No manager user found")

        mid = str(manager.id)
        aid = str(admin.id) if admin else None
        now = datetime.now(timezone.utc)
        stamp = uuid.uuid4().hex[:6]

        # ── A) ALL TAGS TRUE ─────────────────────────────────────────────
        # verified + partner req + auto mail + sent by admin + already exists
        # Plus resends: same channel / different time / different person fields
        email_all = _email(f"alltags-{stamp}")
        dir_person = _person(email_all, "Avery", "Alltags", "London")
        _directory(db, person=dir_person, manager_id=mid, admin_id=aid, when=now)

        all_row = intake_manager_submission(
            db,
            person=_person(email_all, "Avery", "Manager", "Manchester"),
            action="Add",
            manager_id=mid,
            manager_notes="Combo demo: manager form (differs from directory)",
        )
        db.flush()

        # Same person, same channel (auto), different time + different data
        intake_automated_email_request(
            db,
            person=_person(email_all, "Avery", "AutoOne", "Birmingham"),
            action="Add",
            source_gmail_message_id=f"demo-combo-all-a1-{stamp}",
            from_email="em@myptzone.co",
            subject="Roster #1 — different last name + location",
            inbox_email="ogs529@gmail.com",
            received_at=now - timedelta(hours=6),
        )
        db.flush()
        intake_automated_email_request(
            db,
            person=_person(email_all, "Avery", "AutoTwo", "Leeds"),
            action="Add",
            source_gmail_message_id=f"demo-combo-all-a2-{stamp}",
            from_email="em@myptzone.co",
            subject="Roster #2 — resend, different data again",
            inbox_email="ogs529@gmail.com",
            received_at=now - timedelta(hours=2),
        )
        db.flush()

        # Same channel (admin) twice, different submitter + different email on person
        intake_manager_submission(
            db,
            person=_person(f"avery.a1-{stamp}@{DEMO_DOMAIN}", "Avery", "Manager", "Manchester"),
            action="Add",
            manager_id=None,
            submitted_by=_admin("Mil"),
            manager_notes="Combo demo: Admin form #1",
        )
        db.flush()
        intake_manager_submission(
            db,
            person=_person(f"avery.a2-{stamp}@{DEMO_DOMAIN}", "Avery", "Manager", "Manchester"),
            action="Add",
            manager_id=None,
            submitted_by=_admin("Alex"),
            manager_notes="Combo demo: Admin form #2 resend",
        )
        db.flush()
        db.refresh(all_row)
        out.append(
            _result(
                "ALL TAGS (verified + manager + auto + admin + already exists)",
                all_row,
                "Open this first — every tag, comparison diffs, intakes list with who/when/differs",
            )
        )

        # ── B) Same channel resend only (manager ×2 via second admin? use auto×3) ──
        email_resend = _email(f"resend-{stamp}")
        resend = intake_manager_submission(
            db,
            person=_person(email_resend, "Blake", "Resend", "Bristol"),
            action="Add",
            manager_id=mid,
            manager_notes="Combo demo: auto resends only",
        )
        db.flush()
        for i, (last, loc) in enumerate(
            (("MailA", "Bath"), ("MailB", "Exeter"), ("MailC", "Plymouth")),
            start=1,
        ):
            intake_automated_email_request(
                db,
                person=_person(email_resend, "Blake", last, loc),
                action="Add",
                source_gmail_message_id=f"demo-combo-resend-{i}-{stamp}",
                from_email="em@myptzone.co",
                subject=f"Resend mail #{i}",
                inbox_email="ogs529@gmail.com",
                received_at=now - timedelta(hours=5 - i),
            )
            db.flush()
        db.refresh(resend)
        out.append(
            _result(
                "Same channel resend (1 manager + 3 auto, different data each time)",
                resend,
                "Same person merged; each auto shows Differs chips for Name/Location",
            )
        )

        # ── B2) Multi Manager form (same person, 3 form submits, different data) ──
        email_mgr = _email(f"multimgr-{stamp}")
        mgr_versions = (
            ("First", "York", "Manager form #1 — initial request", 8),
            ("Second", "Leeds", "Manager form #2 — corrected last name + location", 4),
            ("Third", "Sheffield", "Manager form #3 — resubmitted again", 1),
        )
        multimgr = None
        for i, (last, loc, notes, hours_ago) in enumerate(mgr_versions, start=1):
            multimgr = intake_manager_submission(
                db,
                person=_person(email_mgr, "Morgan", last, loc),
                action="Add",
                manager_id=mid,
                manager_notes=notes,
            )
            db.flush()
            # Stagger timestamps so the Manager form version table shows distinct times.
            _stamp_latest_event(
                multimgr,
                event_type="manager",
                when=now - timedelta(hours=hours_ago),
            )
            db.flush()
        assert multimgr is not None
        db.refresh(multimgr)
        out.append(
            _result(
                "Multi Manager form (3 submits, same person, different data)",
                multimgr,
                "Open Manager column cue / intakes — Manager #1 #2 #3 table with conflicts",
            )
        )

        # ── C) Email-only same_person (different name + location) ─────────
        email_only = _email(f"emailonly-{stamp}")
        eo = intake_manager_submission(
            db,
            person=_person(email_only, "Chris", "One", "Oxford"),
            action="Add",
            manager_id=mid,
            manager_notes="Combo demo: email-only match",
        )
        db.flush()
        intake_automated_email_request(
            db,
            person=_person(email_only, "Christina", "Two", "Cambridge"),
            action="Add",
            source_gmail_message_id=f"demo-combo-emailonly-{stamp}",
            from_email="em@myptzone.co",
            subject="Same email, different name + location",
            inbox_email="ogs529@gmail.com",
            received_at=now - timedelta(minutes=30),
        )
        db.flush()
        db.refresh(eo)
        out.append(
            _result(
                "Same email / different person fields (email-only match)",
                eo,
                "Merges by email alone — heavy comparison diffs",
            )
        )

        # ── D) SEPARATE rows: same email, different action ────────────────
        email_sep = _email(f"separate-{stamp}")
        rem = intake_automated_email_request(
            db,
            person=_person(email_sep, "Drew", "Split", "Glasgow"),
            action="Remove",
            source_gmail_message_id=f"demo-combo-sep-rm-{stamp}",
            from_email="em@myptzone.co",
            subject="Remove notice",
            inbox_email="ogs529@gmail.com",
            received_at=now - timedelta(minutes=15),
        )
        db.flush()
        add = intake_manager_submission(
            db,
            person=_person(email_sep, "Drew", "Split", "Glasgow"),
            action="Add",
            manager_id=mid,
            manager_notes="Combo demo: Add while Remove auto is open → separate rows",
        )
        db.flush()
        db.refresh(rem)
        db.refresh(add)
        out.append(
            _result(
                "SEPARATE: Auto Remove (awaiting)",
                rem,
                "Same email as next row but different action → does NOT merge",
            )
        )
        out.append(
            _result(
                "SEPARATE: Manager Add (sibling of Remove)",
                add,
                "Pair with the Remove row above — two New requests, same person email",
            )
        )

        db.commit()
        return [{"purgedBeforeSeed": purged}, *out]
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
            n = purge_demo_rows(db)
            db.commit()
            print(f"Purged {n} demo row(s).")
        finally:
            db.close()
        return

    results = seed_demos()
    print("Seeded combo demos:\n")
    for item in results:
        if "purgedBeforeSeed" in item:
            print(f"  purged: {item['purgedBeforeSeed']}\n")
            continue
        print(f"• {item['label']}")
        print(f"  id:     {item['id']}")
        print(f"  email:  {item['email']}")
        print(f"  action: {item['action']}")
        print(f"  events: {item['events']}")
        print(f"  tags:   {item['tags']}")
        print(f"  try:    {item['hint']}")
        print()


if __name__ == "__main__":
    main()
