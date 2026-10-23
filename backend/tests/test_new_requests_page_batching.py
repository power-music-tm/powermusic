"""New Requests /page serialization: batched reads must match per-row reads.

Against a remote Postgres every query is a network round trip, so the page
used to take ~190 queries (~60s locally). These tests pin the batched path to
the original per-row answers and keep the query count flat as rows grow.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.types import ARRAY

from app import manager_request_serialize, models, schemas
from app.directory_person_match import _probe_handled_rows, prefetch_probe_handled_rows
from app.duplicate_group_service import process_request_grouping
from app.manager_request_serialize import directory_rows_to_api_dicts, requests_to_api_dicts
from app.read_cache import read_cache_scope

sqlite3.register_adapter(list, json.dumps)
sqlite3.register_adapter(dict, json.dumps)


@compiles(ARRAY, "sqlite")
def _compile_array(type_, compiler, **kw):
    return "JSON"


@compiles(JSONB, "sqlite")
def _compile_jsonb(type_, compiler, **kw):
    return "JSON"


@pytest.fixture()
def engine():
    eng = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(bind=eng)
    return eng


@pytest.fixture()
def db(engine):
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        yield session
    finally:
        session.close()


@contextlib.contextmanager
def count_queries(engine):
    seen = {"n": 0}

    def _count(*_args, **_kwargs):
        seen["n"] += 1

    event.listen(engine, "after_cursor_execute", _count)
    try:
        yield seen
    finally:
        event.remove(engine, "after_cursor_execute", _count)


def _partner(db: Session, name: str = "PureGym") -> models.Partner:
    now = datetime.now(timezone.utc)
    partner = models.Partner(
        id=f"partner-{uuid.uuid4().hex[:8]}",
        name=name,
        created_at=now,
        updated_at=now,
    )
    db.add(partner)
    db.flush()
    return partner


def _handled(
    partner_id: str,
    *,
    first: str,
    last: str,
    email: str,
    location: str,
    handled_at: datetime,
    outcome: str = "Added",
    archived: bool = False,
) -> models.ManagerRequest:
    return models.ManagerRequest(
        id=f"req-{uuid.uuid4().hex[:8]}",
        person_first_name=first,
        person_last_name=last,
        person_email=email,
        person_location=location,
        action="Add" if outcome == "Added" else "Remove",
        status="handled",
        outcome=outcome,
        received_at=handled_at - timedelta(minutes=1),
        handled_at=handled_at,
        archived_at=handled_at if archived else None,
        partner_id=partner_id,
    )


def _new(partner_id: str, *, first: str, last: str, email: str, location: str, received_at: datetime):
    return models.ManagerRequest(
        id=f"req-{uuid.uuid4().hex[:8]}",
        person_first_name=first,
        person_last_name=last,
        person_email=email,
        person_location=location,
        action="Add",
        status="new",
        received_at=received_at,
        partner_id=partner_id,
    )


def _person(first="", last="", email="", location="") -> schemas.PersonInfo:
    return schemas.PersonInfo.model_construct(
        firstName=first, lastName=last, email=email, location=location,
    )


def _seed_directory(db: Session, partner_id: str, other_partner_id: str) -> None:
    now = datetime.now(timezone.utc)
    rows = [
        _handled(partner_id, first="Ana", last="Lee", email="ana@x.com", location="London", handled_at=now - timedelta(hours=1)),
        _handled(partner_id, first="Ana", last="Lee", email="ana.lee@x.com", location="Leeds", handled_at=now - timedelta(hours=2), outcome="Removed"),
        _handled(partner_id, first="ANA", last="Smith", email="as@x.com", location="London", handled_at=now - timedelta(hours=3)),
        _handled(partner_id, first="Bo", last="Lee", email="bo@x.com", location="london", handled_at=now - timedelta(hours=4)),
        _handled(partner_id, first="Ana", last="Lee", email="ana@x.com", location="Paris", handled_at=now - timedelta(hours=5), archived=True),
        _handled(partner_id, first="Cy", last="Day", email="ANA@x.com", location="Rome", handled_at=now - timedelta(hours=6)),
        _handled(other_partner_id, first="Ana", last="Lee", email="ana@x.com", location="London", handled_at=now - timedelta(hours=1)),
    ]
    db.add_all(rows)
    db.flush()


def test_batched_directory_probe_matches_per_person_queries(db: Session, engine):
    partner = _partner(db)
    other = _partner(db, name="Other Gym")
    gll = _partner(db, name="GLL Better")
    _seed_directory(db, partner.id, other.id)
    now = datetime.now(timezone.utc)
    db.add(_handled(gll.id, first="Ana", last="Lee", email="ana@x.com", location="London", handled_at=now))
    db.flush()

    probes = [
        (_person("Ana", "Lee", "ana@x.com", "London"), partner.id),
        (_person(email="ana@x.com"), partner.id),
        (_person("ana", "lee"), partner.id),
        (_person(first="Ana", location="London"), partner.id),
        (_person(last="Lee", location="London"), partner.id),
        (_person(), partner.id),
        (_person("Ana", "Lee", "ana@x.com", "London"), other.id),
        (_person("Ana", "Lee", "nobody@x.com", "London"), gll.id),
    ]
    expected = [
        [row.id for row in _probe_handled_rows(db, person, partner_id=partner_id)]
        for person, partner_id in probes
    ]
    assert any(expected), "fixture must produce matches"

    with read_cache_scope():
        prefetch_probe_handled_rows(db, probes)
        with count_queries(engine) as seen:
            actual = [
                [row.id for row in _probe_handled_rows(db, person, partner_id=partner_id)]
                for person, partner_id in probes
            ]
        assert seen["n"] == 0

    assert actual == expected


def _build_queue(db: Session, partner_id: str, groups: int) -> None:
    now = datetime.now(timezone.utc)
    for i in range(groups):
        email = f"person{i}-{uuid.uuid4().hex[:6]}@x.com"
        directory = _handled(
            partner_id, first=f"P{i}", last="Lee", email=email, location="London",
            handled_at=now - timedelta(days=1, minutes=i),
        )
        db.add(directory)
        db.flush()
        older = _new(partner_id, first=f"P{i}", last="Lee", email=email, location="London",
                     received_at=now - timedelta(minutes=30 + i))
        newer = _new(partner_id, first=f"P{i}", last="Lee", email=email, location="Leeds",
                     received_at=now - timedelta(minutes=10 + i))
        db.add_all([older, newer])
        db.flush()
        process_request_grouping(db, older)
        process_request_grouping(db, newer)
        db.flush()


def _serialize_page(db: Session, partner_id: str):
    requests = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.partner_id == partner_id, models.ManagerRequest.status == "new")
        .order_by(models.ManagerRequest.id)
        .all()
    )
    directory = (
        db.query(models.ManagerRequest)
        .filter(models.ManagerRequest.partner_id == partner_id, models.ManagerRequest.status == "handled")
        .order_by(models.ManagerRequest.id)
        .all()
    )
    with read_cache_scope():
        return {
            "requests": requests_to_api_dicts(db, requests),
            "persons": directory_rows_to_api_dicts(db, directory),
        }


def test_page_payload_matches_unbatched_serialization(db: Session, monkeypatch):
    partner = _partner(db)
    _build_queue(db, partner.id, groups=3)
    db.commit()

    batched = json.dumps(_serialize_page(db, partner.id), default=str, sort_keys=True)

    monkeypatch.setattr(manager_request_serialize, "read_cache_scope", contextlib.nullcontext)
    monkeypatch.setattr("app.read_cache.is_active", lambda: False)
    db.expire_all()
    unbatched = json.dumps(_serialize_page(db, partner.id), default=str, sort_keys=True)

    assert batched == unbatched


def test_page_query_count_does_not_grow_with_rows(db: Session, engine):
    small = _partner(db)
    large = _partner(db, name="PureGym Large")
    _build_queue(db, small.id, groups=2)
    _build_queue(db, large.id, groups=8)
    db.commit()

    db.expire_all()
    with count_queries(engine) as few:
        _serialize_page(db, small.id)
    db.expire_all()
    with count_queries(engine) as many:
        _serialize_page(db, large.id)

    # Loading the two lists is part of the helper; everything else is batched.
    assert many["n"] <= few["n"] + 2, (few["n"], many["n"])
