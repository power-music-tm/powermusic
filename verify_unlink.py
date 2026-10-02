import os
import sys
import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

sys.path.insert(0, os.path.abspath('backend'))
load_dotenv('backend/.env')

db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/power_music")
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(db_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db = SessionLocal()

from app import models
from app.duplicate_group_service import _new_group_id, unlink_duplicate_members
from app.manager_request_tags import TAG_POTENTIAL_DUPLICATE
from app.manager_request_serialize import _needs_review

def verify():
    now = datetime.now(timezone.utc)
    
    # 2-request group scenario
    req_a = models.ManagerRequest(
        id=f"req-a-{uuid.uuid4().hex[:8]}",
        received_at=now - timedelta(hours=2),
        person_first_name="John",
        person_last_name="Doe",
        person_email="john@test.com",
        status="new",
        tags=[TAG_POTENTIAL_DUPLICATE]
    )
    req_b = models.ManagerRequest(
        id=f"req-b-{uuid.uuid4().hex[:8]}",
        received_at=now - timedelta(hours=1),
        person_first_name="John",
        person_last_name="Doe",
        person_email="john.doe@test.com",
        status="new",
        tags=[TAG_POTENTIAL_DUPLICATE]
    )
    
    group = models.DuplicateGroup(
        id=_new_group_id(),
        classification="potential_duplicate",
        status="active",
        created_at=now,
    )
    
    db.add(group)
    db.flush()
    
    req_a.duplicate_group_id = group.id
    req_b.duplicate_group_id = group.id
    db.add(req_a)
    db.add(req_b)
    db.flush()
    
    # State before unlink
    needs_review_a_before = _needs_review(req_a.tags, req_a.duplicate_group_id)
    needs_review_b_before = _needs_review(req_b.tags, req_b.duplicate_group_id)
    print(f"BEFORE UNLINK:")
    print(f"  Req A needs_review: {needs_review_a_before}, Tags: {req_a.tags}, Group: {req_a.duplicate_group_id}")
    print(f"  Req B needs_review: {needs_review_b_before}, Tags: {req_b.tags}, Group: {req_b.duplicate_group_id}")
    
    # Perform unlink!
    print("\n--- UNLINKING REQ B ---")
    unlink_duplicate_members(db, group.id, req_a.id, req_b.id)
    # The actual router would call commit, we'll do it manually to mimic it.
    db.commit()
    
    # State after unlink
    db.refresh(req_a)
    db.refresh(req_b)
    db.refresh(group)
    
    needs_review_a_after = _needs_review(req_a.tags, req_a.duplicate_group_id)
    needs_review_b_after = _needs_review(req_b.tags, req_b.duplicate_group_id)
    
    print(f"\nAFTER UNLINK:")
    print(f"  Req A needs_review: {needs_review_a_after}, Tags: {req_a.tags}, Group: {req_a.duplicate_group_id}")
    print(f"  Req B needs_review: {needs_review_b_after}, Tags: {req_b.tags}, Group: {req_b.duplicate_group_id}")
    print(f"  Group status: {group.status}")
    
    if not needs_review_a_after and not needs_review_b_after and not req_a.duplicate_group_id and not req_b.duplicate_group_id:
        print("\nSUCCESS! Both requests are standalone.")
    else:
        print("\nFAIL! One or both requests retain stale duplicate state.")
        sys.exit(1)

if __name__ == "__main__":
    verify()
