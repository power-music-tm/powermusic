"""Tests for Gmail watch renewal and cron auth dual-secret acceptance.

Sections
--------
TestRenewWatchesForce   – renew_watches(cushion=0) is unconditional
TestCronAuthDualSecret  – Bearer CRON_SECRET accepted even when PILOT2_CRON_SECRET differs
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers import pilot2 as pilot2_router
from app.pilot2 import config, sync


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _connected_account(email: str, watch_expiration=None, *, oauth_token: str = "tok") -> SimpleNamespace:
    return SimpleNamespace(
        id=email,
        email=email,
        status="Connected",
        watch_expiration=watch_expiration,
        oauth_refresh_token=oauth_token,
    )


def _db_with_accounts(accounts: list) -> MagicMock:
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = accounts
    return db


# ---------------------------------------------------------------------------
# 1. renew_watches with cushion=0 (unconditional / force mode)
# ---------------------------------------------------------------------------

class TestRenewWatchesForce:
    @pytest.fixture(autouse=True)
    def _push_on(self, monkeypatch):
        monkeypatch.setattr(config, "GMAIL_MODE", "live")
        monkeypatch.setattr(config, "GMAIL_PUBSUB_TOPIC", "projects/p/topics/t")

    def test_force_renews_inbox_with_6_days_remaining(self):
        """cushion=timedelta(days=8) -> every Connected inbox renewed, even with 6 days left.

        The cron endpoint defaults to cushion_hours=168 (7 days). Since Gmail
        watches last at most 7 days, any live watch expires within 7 days of
        now, so cushion=7d+ means every account is always 'due'.
        timedelta(days=8) simulates that worst-case scenario explicitly.
        """
        future = datetime.now(timezone.utc) + timedelta(days=6)
        account = _connected_account("inbox@powermusic.com", watch_expiration=future)
        db = _db_with_accounts([account])

        armed = []
        with patch.object(sync, "arm_watch", side_effect=lambda d, a: armed.append(a.email) or True):
            summary = sync.renew_watches(db, cushion=timedelta(days=8))

        assert account.email in armed, "Account with 6 days remaining was skipped but should be renewed"
        assert summary["renewed"] == 1
        assert summary["skipped"] == 0
        assert summary["failed"] == 0

    def test_force_renews_inbox_with_no_expiration(self):
        """cushion=0 -> accounts with watch_expiration=None are also renewed."""
        account = _connected_account("no-exp@powermusic.com", watch_expiration=None)
        db = _db_with_accounts([account])

        with patch.object(sync, "arm_watch", return_value=True) as mock_arm:
            summary = sync.renew_watches(db, cushion=timedelta(0))

        mock_arm.assert_called_once()
        assert summary["renewed"] == 1

    def test_error_in_one_inbox_does_not_stop_next(self):
        """An exception in arm_watch for inbox-A must not prevent inbox-B from running."""
        far_future = datetime.now(timezone.utc) + timedelta(days=6)
        account_a = _connected_account("a@powermusic.com", watch_expiration=far_future)
        account_b = _connected_account("b@powermusic.com", watch_expiration=far_future)
        db = _db_with_accounts([account_a, account_b])

        call_order = []

        def fake_arm(d, account):
            call_order.append(account.email)
            if account.email == "a@powermusic.com":
                raise RuntimeError("Gmail API boom")
            return True

        with patch.object(sync, "arm_watch", side_effect=fake_arm):
            # cushion=8d ensures both accounts are 'due' (6 days < 8 days cushion)
            summary = sync.renew_watches(db, cushion=timedelta(days=8))

        assert "b@powermusic.com" in call_order, "inbox-B was never attempted after inbox-A failed"
        assert summary["failed"] == 1
        assert summary["renewed"] == 1

    def test_cushion_48h_still_skips_far_future(self):
        """Sanity: the conditional path (cushion=48h) still skips a 6-day inbox."""
        far_future = datetime.now(timezone.utc) + timedelta(days=6)
        account = _connected_account("late@powermusic.com", watch_expiration=far_future)
        db = _db_with_accounts([account])

        with patch.object(sync, "arm_watch") as mock_arm:
            summary = sync.renew_watches(db, cushion=timedelta(hours=48))

        mock_arm.assert_not_called()
        assert summary["skipped"] == 1
        assert summary["renewed"] == 0


# ---------------------------------------------------------------------------
# 2. cron_auth dual-secret acceptance
# ---------------------------------------------------------------------------

PILOT2_SECRET = "pilot2-secret-aaa"
CRON_SECRET_VAL = "cron-secret-bbb"


@pytest.fixture
def renewal_client(monkeypatch):
    """TestClient with both PILOT2_CRON_SECRET and CRON_SECRET set to different values."""
    monkeypatch.setenv("PILOT2_CRON_SECRET", PILOT2_SECRET)
    monkeypatch.setenv("CRON_SECRET", CRON_SECRET_VAL)
    monkeypatch.setattr(config, "GMAIL_MODE", "live")
    monkeypatch.setattr(config, "GMAIL_PUBSUB_TOPIC", "projects/p/topics/t")
    app = FastAPI()
    app.include_router(pilot2_router.router)
    app.dependency_overrides[pilot2_router.get_db] = lambda: MagicMock()
    return TestClient(app)


class TestCronAuthDualSecret:
    def test_bearer_with_cron_secret_accepted_when_pilot2_differs(self, renewal_client):
        """Vercel sends Authorization: Bearer <CRON_SECRET>.
        Must be accepted even though PILOT2_CRON_SECRET is also set (and different)."""
        with patch.object(sync, "renew_watches", return_value={"renewed": 1, "skipped": 0, "failed": 0}):
            r = renewal_client.get(
                "/api/pilot2/gmail/watch/renew",
                headers={"Authorization": f"Bearer {CRON_SECRET_VAL}"},
            )
        assert r.status_code == 200, f"Expected 200 but got {r.status_code}: {r.text}"
        assert r.json()["renewed"] == 1

    def test_bearer_with_pilot2_secret_also_accepted(self, renewal_client):
        """PILOT2_CRON_SECRET value in Bearer header must also be accepted."""
        with patch.object(sync, "renew_watches", return_value={"renewed": 1, "skipped": 0, "failed": 0}):
            r = renewal_client.get(
                "/api/pilot2/gmail/watch/renew",
                headers={"Authorization": f"Bearer {PILOT2_SECRET}"},
            )
        assert r.status_code == 200

    def test_wrong_token_returns_401(self, renewal_client):
        """A token that matches neither configured secret must return 401."""
        with patch.object(sync, "renew_watches", return_value={"renewed": 1, "skipped": 0, "failed": 0}):
            r = renewal_client.get(
                "/api/pilot2/gmail/watch/renew",
                headers={"Authorization": "Bearer completely-wrong-token"},
            )
        assert r.status_code == 401

    def test_no_token_returns_401(self, renewal_client):
        """A request with no auth at all must return 401."""
        r = renewal_client.get("/api/pilot2/gmail/watch/renew")
        assert r.status_code == 401

    def test_query_secret_cron_secret_accepted(self, renewal_client):
        """?secret= with CRON_SECRET value is accepted (backward compat)."""
        with patch.object(sync, "renew_watches", return_value={"renewed": 0, "skipped": 1, "failed": 0}):
            r = renewal_client.get(
                f"/api/pilot2/gmail/watch/renew?secret={CRON_SECRET_VAL}",
            )
        assert r.status_code == 200

    def test_failed_inbox_returns_500(self, renewal_client):
        """If any inbox fails, the endpoint returns HTTP 500 (so Vercel marks cron as failed)."""
        with patch.object(
            sync, "renew_watches",
            return_value={"renewed": 1, "skipped": 0, "failed": 1},
        ):
            r = renewal_client.get(
                "/api/pilot2/gmail/watch/renew",
                headers={"Authorization": f"Bearer {CRON_SECRET_VAL}"},
            )
        assert r.status_code == 500
        body = r.json()
        assert body["failed"] == 1
        assert body["renewed"] == 1
