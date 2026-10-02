import sys
sys.path.append('.')
from app.database import SessionLocal
from app import models
from app.user_display import load_users_by_id

db = SessionLocal()
req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == 'req-043').first()
managers = load_users_by_id(db, {req.manager_id})
print(f"managers keys: {list(managers.keys())}")
print(f"req.manager_id type: {type(req.manager_id)}")
print(f"managers.get(req.manager_id): {managers.get(req.manager_id)}")
print(f"managers.get(str): {managers.get(str(list(managers.keys())[0]))}")
