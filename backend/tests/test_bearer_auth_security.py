"""Security tests for JWT bearer verification and role gates."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.api import auth as auth_mod
from app.api.auth import AuthenticatedUser, require_admin, require_manager, verify_bearer_token


class TestVerifyBearerToken:
    def test_missing_header_is_401(self):
        with pytest.raises(HTTPException) as exc:
            verify_bearer_token(None)
        assert exc.value.status_code == 401

    def test_non_bearer_scheme_is_401(self):
        with pytest.raises(HTTPException) as exc:
            verify_bearer_token("Basic dXNlcjpwYXNz")
        assert exc.value.status_code == 401

    def test_garbage_jwt_is_401(self, monkeypatch):
        monkeypatch.setattr(auth_mod, "SUPABASE_URL", "")
        monkeypatch.setattr(auth_mod, "JWT_SECRET", "unit-test-hs256-secret-key!!")
        with pytest.raises(HTTPException) as exc:
            verify_bearer_token("Bearer not.a.jwt")
        assert exc.value.status_code == 401

    def test_alg_none_attack_rejected(self, monkeypatch):
        """Classic JWT alg=none bypass must not authenticate."""
        import base64
        import json

        monkeypatch.setattr(auth_mod, "SUPABASE_URL", "")
        monkeypatch.setattr(auth_mod, "JWT_SECRET", "unit-test-hs256-secret-key!!")

        def b64url(data: bytes) -> str:
            return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

        header = b64url(json.dumps({"alg": "none", "typ": "JWT"}).encode())
        payload = b64url(
            json.dumps({"sub": "attacker", "role": "admin", "aud": "authenticated"}).encode()
        )
        forged = f"{header}.{payload}."

        with pytest.raises(HTTPException) as exc:
            verify_bearer_token(f"Bearer {forged}")
        assert exc.value.status_code == 401

    def test_auth_unconfigured_is_503(self, monkeypatch):
        monkeypatch.setattr(auth_mod, "SUPABASE_URL", "")
        monkeypatch.setattr(auth_mod, "JWT_SECRET", "")
        with patch.object(auth_mod, "auth_is_configured", return_value=False):
            with pytest.raises(HTTPException) as exc:
                verify_bearer_token("Bearer anything")
        assert exc.value.status_code == 503


class TestRoleGates:
    def test_manager_cannot_pass_require_admin(self):
        user = AuthenticatedUser(id="u1", email="m@example.com", role="manager")
        with patch.object(auth_mod, "auth_is_required", return_value=True):
            with pytest.raises(HTTPException) as exc:
                require_admin(user=user)
        assert exc.value.status_code == 403
        assert "Admin" in str(exc.value.detail)

    def test_admin_passes_require_admin(self):
        user = AuthenticatedUser(id="u1", email="a@example.com", role="admin")
        with patch.object(auth_mod, "auth_is_required", return_value=True):
            assert require_admin(user=user) is user

    def test_admin_cannot_pass_require_manager(self):
        user = AuthenticatedUser(id="u1", email="a@example.com", role="admin")
        with patch.object(auth_mod, "auth_is_required", return_value=True):
            with pytest.raises(HTTPException) as exc:
                require_manager(user=user)
        assert exc.value.status_code == 403

    def test_manager_passes_require_manager(self):
        user = AuthenticatedUser(id="u1", email="m@example.com", role="manager")
        with patch.object(auth_mod, "auth_is_required", return_value=True):
            assert require_manager(user=user) is user
