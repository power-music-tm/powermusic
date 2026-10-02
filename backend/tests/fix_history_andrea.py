import sys
sys.path.append('.')
from app.database import SessionLocal
from app import models
import json

db = SessionLocal()
reqs = db.query(models.ManagerRequest).all()
updated = 0
for req in reqs:
    intake = req.intake_persons
    if not intake or not isinstance(intake, dict):
        continue
    history = intake.get("history")
    if not history or not isinstance(history, list):
        continue
    
    changed = False
    for event in history:
        if event.get("handledBy") == "Andrea":
            event["handledBy"] = "Power Music Admin"
            changed = True
        if event.get("detail") == "By Andrea":
            event["detail"] = "By Power Music Admin"
            changed = True
        if event.get("managerName") == "Andrea (Admin)" or event.get("managerName") == "Andrea":
            event["managerName"] = "Power Music Admin"
            changed = True
            
    if changed:
        # SQLAlchemy needs to know the JSON column was modified
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(req, "intake_persons")
        updated += 1

db.commit()
print(f"Updated history in {updated} requests")
