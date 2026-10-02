from app.database import SessionLocal
from app import models

db = SessionLocal()

reqs = db.query(models.ManagerRequest).filter(
    models.ManagerRequest.duplicate_group_id == 'dup-grp-6ebc5af96292'
).all()

for r in reqs:
    print(f"ID: {r.id}, Group: {r.duplicate_group_id}, First: {r.person_first_name}, Last: {r.person_last_name}, Email: {r.person_email}, Loc: {r.person_location}, Received: {r.received_at}")

