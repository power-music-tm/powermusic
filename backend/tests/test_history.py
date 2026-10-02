import sys
sys.path.append('.')
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app import models
from app.duplicate_group_service import _snapshot_discarded_manager_requests
from app.user_display import hydrate_request_users
import json

def test():
    db = SessionLocal()
    req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == 'req-042').first()
    members = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == 'req-043').all()
    hydrate_request_users(db, members + [req])
    events = _snapshot_discarded_manager_requests(req, members, set())
    print(json.dumps(events, indent=2, default=str))

test()
