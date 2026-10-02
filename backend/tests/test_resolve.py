import sys
sys.path.append('.')
from app.database import SessionLocal
from app import models
from app.user_display import hydrate_request_users, resolve_manager_name

db = SessionLocal()
req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == 'req-043').first()
hydrate_request_users(db, [req])
print(f"req._manager_user: {req._manager_user}")
print(f"resolve_manager_name(req): {resolve_manager_name(req)}")
