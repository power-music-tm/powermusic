"""Regression tests for manager batch submission jobs."""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy.orm import Session

from app import models, schemas
from app.manager_submission_jobs import enqueue_manager_batch, process_manager_submission_job_by_id
from app.database import SessionLocal


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
        session.rollback()
    finally:
        session.close()


@pytest.fixture
def manager(db: Session) -> models.PowermusicUser:
    row = db.query(models.PowermusicUser).filter(models.PowermusicUser.role == "manager").first()
    if row is None:
        pytest.skip("No manager profile in database for batch job tests")
    return row


def test_batch_job_result_is_json_serializable(db: Session, manager: models.PowermusicUser):
    suffix = uuid.uuid4().hex[:8]
    req_in = schemas.ManagerBatchRequestIn(
        submittedBy=schemas.SubmittedBy(
            firstName=manager.first_name or "Test",
            lastName=manager.last_name or "Manager",
            email=f"manager-{suffix}@gmail.com",
            club=manager.club or "Test Club",
        ),
        people=[
            schemas.PersonInfo(
                firstName="Batch",
                lastName="One",
                email=f"batch-one-{suffix}@gmail.com",
                location="London",
            ),
            schemas.PersonInfo(
                firstName="Batch",
                lastName="Two",
                email=f"batch-two-{suffix}@gmail.com",
                location="Manchester",
            ),
        ],
        action="Add",
    )

    job = enqueue_manager_batch(db, manager_id=str(manager.id), req_in=req_in)
    job = process_manager_submission_job_by_id(db, job.id)

    assert job is not None
    assert job.status == "done", job.error
    assert job.result == {"count": 2}
    json.dumps(job.result)
