"""Postgres-backed queue for manager batch submissions."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from app import models, schemas
from app.manager_request_intake import intake_manager_submission, manager_id_for_email
from app.partner_allowlists import assert_manager_email_allowed
from app.request_display import allocate_request_ids, hydrate_request_display
from app.manager_request_serialize import requests_to_api_dicts
from app.manager_request_summary_cache import invalidate_manager_request_summary
from app.partner_requests_realtime import notify_admin_requests_changed
from app.manager_request_stats import increment_manager_request_stats

JOB_PENDING = "pending"
JOB_PROCESSING = "processing"
JOB_DONE = "done"
JOB_FAILED = "failed"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _manager_id_for_submitter(
    db: Session,
    submitted_by: schemas.SubmittedBy,
    *,
    manager_user_id: Optional[str] = None,
) -> Optional[str]:
    if manager_user_id and manager_user_id != "dev-bypass":
        return manager_user_id
    return manager_id_for_email(db, submitted_by.email or "")


def _create_manager_request_row(
    db: Session,
    *,
    submitted_by: schemas.SubmittedBy,
    person: schemas.PersonInfo,
    action: str,
    notes: Optional[str],
    partner_id: Optional[str] = None,
    new_id: Optional[str] = None,
    manager_user_id: Optional[str] = None,
) -> models.ManagerRequest:
    return intake_manager_submission(
        db,
        person=person,
        action=action,
        manager_notes=notes,
        manager_id=_manager_id_for_submitter(db, submitted_by, manager_user_id=manager_user_id),
        partner_id=partner_id,
        new_id=new_id,
        submitted_by=submitted_by,
    )


def enqueue_manager_batch(
    db: Session,
    *,
    manager_id: str,
    req_in: schemas.ManagerBatchRequestIn,
) -> models.ManagerSubmissionJob:
    job = models.ManagerSubmissionJob(
        id=str(uuid.uuid4()),
        manager_id=None if manager_id == "dev-bypass" else manager_id,
        status=JOB_PENDING,
        payload=req_in.model_dump(mode="json"),
        created_at=_utcnow(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def process_manager_batch_payload(
    db: Session,
    payload: dict[str, Any],
    *,
    manager_user_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    req_in = schemas.ManagerBatchRequestIn.model_validate(payload)
    partner_id = req_in.partnerId
    if partner_id is None:
        partner_id = assert_manager_email_allowed(
            db,
            req_in.submittedBy.email or "",
            manager_user_id=manager_user_id,
        )
    request_ids = allocate_request_ids(db, len(req_in.people))
    new_requests = [
        _create_manager_request_row(
            db,
            submitted_by=req_in.submittedBy,
            person=person,
            action=req_in.action,
            notes=person.notes or req_in.notes,
            partner_id=partner_id,
            new_id=request_id,
            manager_user_id=manager_user_id,
        )
        for request_id, person in zip(request_ids, req_in.people)
    ]
    for req in new_requests:
        increment_manager_request_stats(db, req)
    db.commit()

    for req in new_requests:
        db.refresh(req)
    hydrate_request_display(new_requests)
    return requests_to_api_dicts(db, new_requests)


def process_pending_manager_submission_jobs(db: Session, *, limit: int = 20) -> dict[str, int]:
    claimed = (
        db.query(models.ManagerSubmissionJob)
        .filter(models.ManagerSubmissionJob.status == JOB_PENDING)
        .order_by(models.ManagerSubmissionJob.created_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
        .all()
    )

    processed = 0
    failed = 0

    for job in claimed:
        job.status = JOB_PROCESSING
        job.started_at = _utcnow()
        db.commit()

        try:
            manager_user_id = str(job.manager_id) if job.manager_id else "dev-bypass"
            items = process_manager_batch_payload(
                db,
                job.payload,
                manager_user_id=manager_user_id,
            )
            job.status = JOB_DONE
            job.result = {"count": len(items)}
            job.error = None
            processed += 1
        except Exception as exc:
            db.rollback()
            job = (
                db.query(models.ManagerSubmissionJob)
                .filter(models.ManagerSubmissionJob.id == job.id)
                .first()
            )
            if job is not None:
                job.status = JOB_FAILED
                job.error = str(exc)[:2000]
                job.result = None
                failed += 1
        finally:
            if job is not None:
                job.finished_at = _utcnow()
                db.commit()
                if job.status == JOB_DONE and job.manager_id:
                    invalidate_manager_request_summary(str(job.manager_id))
                    notify_admin_requests_changed("manager_batch")

    return {"claimed": len(claimed), "processed": processed, "failed": failed}


def process_manager_submission_job_by_id(db: Session, job_id: str) -> Optional[models.ManagerSubmissionJob]:
    job = (
        db.query(models.ManagerSubmissionJob)
        .filter(models.ManagerSubmissionJob.id == job_id)
        .with_for_update()
        .first()
    )
    if job is None or job.status != JOB_PENDING:
        return job

    job.status = JOB_PROCESSING
    job.started_at = _utcnow()
    db.commit()

    try:
        manager_user_id = str(job.manager_id) if job.manager_id else "dev-bypass"
        items = process_manager_batch_payload(
            db,
            job.payload,
            manager_user_id=manager_user_id,
        )
        job.status = JOB_DONE
        job.result = {"count": len(items)}
        job.error = None
    except Exception as exc:
        db.rollback()
        job = (
            db.query(models.ManagerSubmissionJob)
            .filter(models.ManagerSubmissionJob.id == job_id)
            .first()
        )
        if job is not None:
            job.status = JOB_FAILED
            job.error = str(exc)[:2000]
            job.result = None
    finally:
        if job is not None:
            job.finished_at = _utcnow()
            db.commit()
            db.refresh(job)
            if job.status == JOB_DONE and job.manager_id:
                invalidate_manager_request_summary(str(job.manager_id))
                notify_admin_requests_changed("manager_batch")

    return job


def get_manager_submission_job(
    db: Session,
    *,
    job_id: str,
    manager_id: str,
) -> Optional[models.ManagerSubmissionJob]:
    query = db.query(models.ManagerSubmissionJob).filter(models.ManagerSubmissionJob.id == job_id)
    if manager_id and manager_id != "dev-bypass":
        try:
            manager_uuid = uuid.UUID(str(manager_id))
        except ValueError:
            return None
        query = query.filter(models.ManagerSubmissionJob.manager_id == manager_uuid)
    return query.first()
