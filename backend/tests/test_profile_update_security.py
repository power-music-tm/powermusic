"""Self-service profile update: name allowed; role/partner never taken from client."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import auth as auth_mod
from app.api.auth import AuthenticatedUser, get_authenticated_user, invalidate_auth_cache
from app.api.dependencies import get_db
from app import schemas


ADMIN = AuthenticatedUser(
    id=str(uuid.uuid4()),
    email="onboarding@powermusic.com",
    role="admin",
)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setattr(auth_mod, "AUTH_DISABLED", False)
    invalidate_auth_cache()

    app = FastAPI()
    app.include_router(auth_mod.auth_router)
    app.dependency_overrides[get_authenticated_user] = lambda: ADMIN
    yield app
    app.dependency_overrides.clear()
    invalidate_auth_cache()


def test_patch_me_updates_name_only(client):
    profile = SimpleNamespace(
        id=uuid.UUID(ADMIN.id),
        email=ADMIN.email,
        full_name="Old Name",
        first_name="Old",
        last_name="Name",
        club=None,
        role="admin",
        partner_id=None,
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = profile
    client.dependency_overrides[get_db] = lambda: db

    # Extra fields like role must be ignored by the schema / handler
    r = TestClient(client).patch(
        "/api/auth/me",
        json={"fullName": "Andrea New", "role": "manager", "partner_id": "hack"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["full_name"] == "Andrea New"
    assert body["role"] == "admin"
    assert profile.full_name == "Andrea New"
    assert profile.first_name == "Andrea"
    assert profile.last_name == "New"
    assert profile.role == "admin"


def test_patch_me_rejects_xss_name(client):
    profile = SimpleNamespace(
        id=uuid.UUID(ADMIN.id),
        email=ADMIN.email,
        full_name="Andrea",
        first_name="Andrea",
        last_name=None,
        club=None,
        role="admin",
        partner_id=None,
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = profile
    client.dependency_overrides[get_db] = lambda: db

    r = TestClient(client).patch(
        "/api/auth/me",
        json={"fullName": "<script>alert(1)</script>"},
    )
    assert r.status_code == 422
    assert profile.full_name == "Andrea"


def test_profile_update_schema_drops_role_field():
    parsed = schemas.ProfileUpdateIn.model_validate(
        {"fullName": "Andrea", "role": "admin", "partnerId": "x"}
    )
    assert parsed.fullName == "Andrea"
    assert not hasattr(parsed, "role") or "role" not in parsed.model_dump()
