import sys
sys.path.append('.')
from app.database import SessionLocal
from app import models
from app.user_display import hydrate_request_users, resolve_manager_name, user_display_name, user_manager_fields

db = SessionLocal()
req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == 'req-043').first()
hydrate_request_users(db, [req])
print(f"req._manager_user: {req._manager_user}")
print(f"resolve_manager_name(req, manager_user=req._manager_user): '{resolve_manager_name(req, manager_user=req._manager_user)}'")
print(f"user_display_name(req._manager_user): '{user_display_name(req._manager_user)}'")
print(f"user_manager_fields(req._manager_user): {user_manager_fields(req._manager_user)}")
print(f"req._manager_user.first_name: '{req._manager_user.first_name}'")
print(f"req._manager_user.last_name: '{req._manager_user.last_name}'")
print(f"req._manager_user.full_name: '{req._manager_user.full_name}'")
