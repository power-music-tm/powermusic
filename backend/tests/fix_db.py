from app.database import SessionLocal
from app import models
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm.attributes import flag_modified
from app.duplicate_group_service import _clear_duplicate_tags, _sync_group_representative_and_tags

db = SessionLocal()

# The incorrectly grouped Monica requests
req083 = db.query(models.ManagerRequest).filter_by(id="req-083").first()
req102 = db.query(models.ManagerRequest).filter_by(id="req-102").first()

if req083 and req102:
    # 1. Remove them from the Josh Kennedy group
    req083.duplicate_group_id = None
    _clear_duplicate_tags(req083)
    req102.duplicate_group_id = None
    _clear_duplicate_tags(req102)
    
    # 2. Sync the Josh Kennedy group (to remove tags if monica was representative, though she was older)
    josh_group = db.query(models.DuplicateGroup).filter_by(id="dup-grp-6ebc5af96292").first()
    if josh_group:
        _sync_group_representative_and_tags(db, josh_group)
        
    # 3. Create a new group for Monica
    new_group_id = f"dup-grp-{uuid.uuid4().hex[:12]}"
    monica_group = models.DuplicateGroup(
        id=new_group_id,
        partner_id=req083.partner_id,
        classification="confirmed_duplicate",
        status="active",
        created_at=datetime.now(timezone.utc),
        representative_request_id=req102.id,
    )
    db.add(monica_group)
    
    req083.duplicate_group_id = new_group_id
    req102.duplicate_group_id = new_group_id
    
    _sync_group_representative_and_tags(db, monica_group, member_requests=[req083, req102])
    
    db.commit()
    print("Database corrected.")
else:
    print("Could not find Monica requests")
