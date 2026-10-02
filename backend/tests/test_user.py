import sys
sys.path.append('.')
from app.database import SessionLocal
from app import models
import json

db = SessionLocal()
u = db.query(models.PowermusicUser).filter(models.PowermusicUser.id == '03e5f66b-5310-4641-8c1d-ace9dfd05b94').first()
if u:
    print(f"user: {u.first_name} {u.last_name}")
else:
    print("USER NOT FOUND")
