"""Security tests for cron HTTP triggers (secret bypass / fail-closed)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException, Request

from app.api.cron_auth import require_cron_secret


def _request(*, authorization: str | None = None, x_cron_secret: str | None = None) -> Request:
    headers = []
    if authorization:
        headers.append((b"authorization", authorization.encode()))
    if x_cron_secret:
        headers.append((b"x-cron-secret", x_cron_secret.encode()))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "path": "/api/pilot2/cron/renew-watches",
        "raw_path": b"/api/pilot2/cron/renew-watches",
        "root_path": "",
        "scheme": "http",
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
    }
    return Request(scope)


class TestCronAuthFailClosed:
    def test_production_without_secrets_is_503(self, monkeypatch):
        monkeypatch.setenv("VERCEL", "1")
        monkeypatch.delenv("PILOT2_CRON_SECRET", raising=False)
        monkeypatch.delenv("CRON_SECRET", raising=False)
        with pytest.raises(HTTPException) as exc:
            require_cron_secret(_request(authorization="Bearer anything"))
        assert exc.value.status_code == 503

    def test_wrong_bearer_is_401(self, monkeypatch):
        monkeypatch.delenv("VERCEL", raising=False)
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("CRON_SECRET", "correct-secret")
        monkeypatch.delenv("PILOT2_CRON_SECRET", raising=False)
        with pytest.raises(HTTPException) as exc:
            require_cron_secret(_request(authorization="Bearer wrong-secret"))
        assert exc.value.status_code == 401

    def test_missing_secret_when_configured_is_401(self, monkeypatch):
        monkeypatch.delenv("VERCEL", raising=False)
        monkeypatch.setenv("CRON_SECRET", "correct-secret")
        with pytest.raises(HTTPException) as exc:
            require_cron_secret(_request())
        assert exc.value.status_code == 401

    def test_valid_bearer_accepted(self, monkeypatch):
        monkeypatch.delenv("VERCEL", raising=False)
        monkeypatch.setenv("CRON_SECRET", "correct-secret")
        require_cron_secret(_request(authorization="Bearer correct-secret"))

    def test_valid_header_accepted(self, monkeypatch):
        monkeypatch.delenv("VERCEL", raising=False)
        monkeypatch.setenv("PILOT2_CRON_SECRET", "pilot2-secret")
        monkeypatch.delenv("CRON_SECRET", raising=False)
        require_cron_secret(_request(x_cron_secret="pilot2-secret"))

    def test_query_secret_accepted(self, monkeypatch):
        monkeypatch.delenv("VERCEL", raising=False)
        monkeypatch.setenv("CRON_SECRET", "q-secret")
        require_cron_secret(_request(), secret="q-secret")

    def test_prefix_truncation_attack_rejected(self, monkeypatch):
        """Partial secret must not authenticate (compare_digest full-string)."""
        monkeypatch.delenv("VERCEL", raising=False)
        monkeypatch.setenv("CRON_SECRET", "correct-secret-long")
        with pytest.raises(HTTPException) as exc:
            require_cron_secret(_request(authorization="Bearer correct-secret"))
        assert exc.value.status_code == 401

    def test_empty_bearer_rejected_when_secret_set(self, monkeypatch):
        monkeypatch.delenv("VERCEL", raising=False)
        monkeypatch.setenv("CRON_SECRET", "correct-secret")
        with pytest.raises(HTTPException) as exc:
            require_cron_secret(_request(authorization="Bearer "))
        assert exc.value.status_code == 401

    def test_local_dev_open_when_no_secrets(self, monkeypatch):
        monkeypatch.delenv("VERCEL", raising=False)
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.delenv("PILOT2_CRON_SECRET", raising=False)
        monkeypatch.delenv("CRON_SECRET", raising=False)
        require_cron_secret(_request())
