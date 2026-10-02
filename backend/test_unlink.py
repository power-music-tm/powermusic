import sys
from datetime import datetime, timezone
from app.database import SessionLocal
from app.models import ManagerRequest, DuplicateGroup, DismissedDuplicateMatch
from app.duplicate_group_service import _new_group_id, _sync_group_representative_and_tags, unlink_duplicate_members, _clear_duplicate_tags
from app.manager_request_tags import TAG_POTENTIAL_DUPLICATE

def run():
    db = SessionLocal()

    db.execute(ManagerRequest.__table__.delete().where(ManagerRequest.id.in_(["test-req-1", "test-req-2"])))
    db.execute(DuplicateGroup.__table__.delete().where(DuplicateGroup.classification == "test_temp"))
    db.execute(DismissedDuplicateMatch.__table__.delete().where(DismissedDuplicateMatch.request_id_1 == "test-req-1"))
    db.commit()

    now = datetime.now(timezone.utc)
    req1 = ManagerRequest(id="test-req-1", status="new", received_at=now, handled_at=now, manager_id=None, handled_by_admin_id=None, person_first_name="A", person_last_name="B", person_email="a@b.c", person_location="L", action="Add", manager_notes="", admin_notes="", tags=[], outcome="Added", source_email_id=None, source_gmail_message_id=None, intake_persons={}, partner_id=None, archived_at=None, duplicate_group_id=None)
    req2 = ManagerRequest(id="test-req-2", status="new", received_at=now, handled_at=now, manager_id=None, handled_by_admin_id=None, person_first_name="A", person_last_name="B", person_email="a@b.c", person_location="L", action="Add", manager_notes="", admin_notes="", tags=[], outcome="Added", source_email_id=None, source_gmail_message_id=None, intake_persons={}, partner_id=None, archived_at=None, duplicate_group_id=None)

    db.add_all([req1, req2])
    db.flush()

    group = DuplicateGroup(id=_new_group_id(), classification="test_temp", status="active", created_at=now, representative_request_id=req1.id)
    db.add(group)
    db.flush()

    req1.duplicate_group_id = group.id
    req2.duplicate_group_id = group.id
    db.flush()

    req1.tags = [TAG_POTENTIAL_DUPLICATE]
    req2.tags = [TAG_POTENTIAL_DUPLICATE]
    group.representative_request_id = req1.id
    db.flush()
    db.commit()

    unlink_duplicate_members(db, group.id, req1.id, req2.id)
    db.commit()

    r1 = db.query(ManagerRequest).filter_by(id="test-req-1").first()
    r2 = db.query(ManagerRequest).filter_by(id="test-req-2").first()

    print("AFTER UNLINK:")
    print("Req 1 group:", r1.duplicate_group_id, "tags:", r1.tags)
    print("Req 2 group:", r2.duplicate_group_id, "tags:", r2.tags)

    db.execute(ManagerRequest.__table__.delete().where(ManagerRequest.id.in_(["test-req-1", "test-req-2"])))
    db.execute(DuplicateGroup.__table__.delete().where(DuplicateGroup.id == group.id))
    db.execute(DismissedDuplicateMatch.__table__.delete().where(DismissedDuplicateMatch.request_id_1 == "test-req-1"))
    db.commit()


if __name__ == "__main__":
    run()

