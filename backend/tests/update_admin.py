import sys
sys.path.append('.')
from app.database import SessionLocal
from app import models

db = SessionLocal()
admins = db.query(models.PowermusicUser).all()
for admin in admins:
    if admin.first_name == "Andrea" or admin.full_name == "Andrea":
        admin.first_name = "Power Music Admin"
        admin.last_name = ""
        admin.full_name = "Power Music Admin"

db.commit()
print("Updated admins")
