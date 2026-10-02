from sqlalchemy import text
from sqlalchemy.orm import Session


def next_request_id(db: Session) -> str:
    value = db.execute(text("SELECT nextval('request_id_seq')")).scalar_one()
    return f"req-{int(value):03d}"


def next_person_id(db: Session) -> str:
    value = db.execute(text("SELECT nextval('person_id_seq')")).scalar_one()
    return f"ul-{int(value):03d}"
