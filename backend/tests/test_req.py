import sys
sys.path.append('.')
from app.database import SessionLocal
from app import models
import json

db = SessionLocal()
req = db.query(models.ManagerRequest).filter(models.ManagerRequest.id == 'req-043').first()
print(f"manager_id: {req.manager_id}")
print(f"intake_persons: {req.intake_persons}")
print(f"tags: {req.tags}")
