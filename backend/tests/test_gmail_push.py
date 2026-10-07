"""Gmail push (Pub/Sub → webhook) tests. Gmail and the DB are mocked throughout."""

import base64
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers import pilot2 as pilot2_router
from app.pilot2 import config, gmail, pipeline, sync

TOKEN = "unit-test-push-token"
CRON = "unit-test-cron-secret"


def _envelope(payload):
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    return {"message": {"data": base64.b64encode(raw.encode()).decode(), "messageId": "1"}, "subscription": "s"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(config, "GMAIL_PUSH_TOKEN", TOKEN)
    monkeypatch.setattr(config, "CRON_SECRET", CRON)
    app = FastAPI()
    app.include_router(pilot2_router.router)
    app.dependency_overrides[pilot2_router.get_db] = lambda: MagicMock()
    return TestClient(app)


class TestPushWebhook:
    def test_missing_token_is_401(self, client):
        with patch.object(sync, "handle_push_notification") as handler:
            r = client.post("/api/pilot2/gmail/push", json=_envelope({"emailAddress": "a@b.com", "historyId": "1"}))
        assert r.status_code == 401
        handler.assert_not_called()

    def test_wrong_token_is_401(self, client):
        with patch.object(sync, "handle_push_notification") as handler:
            r = client.post("/api/pilot2/gmail/push?token=nope", json=_envelope({"emailAddress": "a@b.com"}))
        assert r.status_code == 401
        handler.assert_not_called()

    def test_unset_server_token_fails_closed(self, client, monkeypatch):
        monkeypatch.setattr(config, "GMAIL_PUSH_TOKEN", "")
        with patch.object(sync, "handle_push_notification") as handler:
            r = client.post("/api/pilot2/gmail/push", json=_envelope({"emailAddress": "a@b.com"}))
            r2 = client.post("/api/pilot2/gmail/push?token=", json=_envelope({"emailAddress": "a@b.com"}))
        assert r.status_code == 401 and r2.status_code == 401
        handler.assert_not_called()

    def test_valid_envelope_calls_sync_once(self, client):
        with patch.object(sync, "handle_push_notification", return_value=2) as handler:
            r = client.post(
                f"/api/pilot2/gmail/push?token={TOKEN}",
                json=_envelope({"emailAddress": "Inbox@Example.com", "historyId": "999"}),
            )
        assert r.status_code == 200
        assert r.json()["changes"] == 2
        handler.assert_called_once()
        assert handler.call_args.args[1] == "Inbox@Example.com"

    @pytest.mark.parametrize("body", [
        "not-json",
        {"message": {}},
        {"message": {"data": "!!!not base64!!!"}},
        {"message": {"data": base64.b64encode(b"not json").decode()}},
        {"message": {"data": base64.b64encode(b'["list"]').decode()}},
        ["not", "a", "dict"],
    ])
    def test_malformed_payload_is_2xx_without_sync(self, client, body):
        with patch.object(sync, "handle_push_notification") as handler:
            if body == "not-json":
                r = client.post(f"/api/pilot2/gmail/push?token={TOKEN}", content="{{{", headers={"content-type": "application/json"})
            else:
                r = client.post(f"/api/pilot2/gmail/push?token={TOKEN}", json=body)
        assert 200 <= r.status_code < 300
        handler.assert_not_called()

    def test_unknown_email_is_200_and_no_sync(self, client):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        client.app.dependency_overrides[pilot2_router.get_db] = lambda: db
        with patch.object(sync, "sync_account_history") as sync_history:
            r = client.post(
                f"/api/pilot2/gmail/push?token={TOKEN}",
                json=_envelope({"emailAddress": "ghost@example.com", "historyId": "1"}),
            )
        assert r.status_code == 200
        assert r.json()["changes"] == 0
        sync_history.assert_not_called()

    def test_permanent_error_is_acked(self, client):
        with patch.object(sync, "handle_push_notification", side_effect=ValueError("bad data")):
            r = client.post(f"/api/pilot2/gmail/push?token={TOKEN}", json=_envelope({"emailAddress": "a@b.com"}))
        assert r.status_code == 200
        assert r.json()["status"] == "error-acked"

    def test_transient_error_is_5xx(self, client):
        err = SimpleNamespace(resp=SimpleNamespace(status=503))
        exc = Exception("gmail down")
        exc.resp = err.resp
        with patch.object(sync, "handle_push_notification", side_effect=exc):
            r = client.post(f"/api/pilot2/gmail/push?token={TOKEN}", json=_envelope({"emailAddress": "a@b.com"}))
        assert r.status_code == 503

    def test_push_uses_stored_cursor_not_pushed_history_id(self):
        account = SimpleNamespace(email="a@b.com", status="Connected", gmail_history_id="100")
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = account
        with patch.object(sync, "sync_account_history", return_value=0) as hist, \
                patch.object(sync, "process_ai_batch", return_value=0), \
                patch("app.pilot2.realtime.workspace_changed"):
            sync.handle_push_notification(db, "A@B.com", "99999")
        hist.assert_called_once_with(db, account)
        assert account.gmail_history_id == "100"


class TestStartWatch:
    def _account(self, history_id=None):
        return SimpleNamespace(email="a@b.com", gmail_history_id=history_id, watch_expiration=None, id="inbox-1")

    def test_stores_expiration_and_seeds_null_cursor(self, monkeypatch):
        monkeypatch.setattr(config, "GMAIL_MODE", "live")
        monkeypatch.setattr(config, "GMAIL_PUBSUB_TOPIC", "projects/p/topics/t")
        expiration_ms = int((datetime.now(timezone.utc) + timedelta(days=7)).timestamp() * 1000)
        account = self._account(history_id=None)
        db = MagicMock()
        with patch.object(gmail, "start_watch", return_value={"historyId": "555", "expiration": str(expiration_ms)}), \
                patch.object(pipeline, "log"):
            assert sync.arm_watch(db, account) is True
        assert account.watch_expiration == datetime.fromtimestamp(expiration_ms / 1000, tz=timezone.utc)
        assert account.watch_expiration.tzinfo is not None
        assert account.gmail_history_id == "555"

    def test_never_overwrites_existing_cursor(self, monkeypatch):
        monkeypatch.setattr(config, "GMAIL_MODE", "live")
        monkeypatch.setattr(config, "GMAIL_PUBSUB_TOPIC", "projects/p/topics/t")
        account = self._account(history_id="100")
        with patch.object(gmail, "start_watch", return_value={"historyId": "999", "expiration": "1900000000000"}), \
                patch.object(pipeline, "log"):
            sync.arm_watch(MagicMock(), account)
        assert account.gmail_history_id == "100"

    def test_gmail_request_body(self, monkeypatch):
        monkeypatch.setattr(config, "GMAIL_MODE", "live")
        monkeypatch.setattr(config, "GMAIL_PUBSUB_TOPIC", "projects/p/topics/t")
        service = MagicMock()
        with patch.object(gmail, "_service_for_account", return_value=service):
            gmail.start_watch(self._account())
        body = service.users.return_value.watch.call_args.kwargs["body"]
        assert body == {"topicName": "projects/p/topics/t", "labelIds": ["INBOX"], "labelFilterBehavior": "INCLUDE"}

    def test_watch_failure_returns_false_without_raising(self, monkeypatch):
        monkeypatch.setattr(config, "GMAIL_MODE", "live")
        monkeypatch.setattr(config, "GMAIL_PUBSUB_TOPIC", "projects/p/topics/t")
        with patch.object(gmail, "start_watch", side_effect=RuntimeError("boom")):
            assert sync.arm_watch(MagicMock(), self._account()) is False


class TestRenewal:
    def _accounts(self):
        now = datetime.now(timezone.utc)
        mk = lambda i, exp: SimpleNamespace(
            id=i, email=f"{i}@x.com", status="Connected", watch_expiration=exp, oauth_refresh_token="tok"
        )
        return [
            mk("soon", now + timedelta(hours=10)),
            mk("never", None),
            mk("later", now + timedelta(days=5)),
        ]

    def _db(self, accounts):
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = accounts
        return db

    @pytest.fixture(autouse=True)
    def _push_on(self, monkeypatch):
        monkeypatch.setattr(config, "GMAIL_MODE", "live")
        monkeypatch.setattr(config, "GMAIL_PUBSUB_TOPIC", "projects/p/topics/t")

    def test_only_expiring_accounts_are_touched(self):
        armed = []
        with patch.object(sync, "arm_watch", side_effect=lambda db, a: armed.append(a.id) or True):
            summary = sync.renew_watches(self._db(self._accounts()), cushion=timedelta(hours=48))
        assert sorted(armed) == ["never", "soon"]
        assert summary == {"renewed": 2, "skipped": 1, "failed": 0}

    def test_one_failure_does_not_stop_others(self):
        def fake(db, a):
            if a.id == "soon":
                raise RuntimeError("boom")
            return True
        with patch.object(sync, "arm_watch", side_effect=fake):
            summary = sync.renew_watches(self._db(self._accounts()), cushion=timedelta(hours=48))
        assert summary == {"renewed": 1, "skipped": 1, "failed": 1}

    def test_poll_cushion_is_24h(self):
        armed = []
        with patch.object(sync, "arm_watch", side_effect=lambda db, a: armed.append(a.id) or True):
            sync.renew_watches(self._db(self._accounts()), cushion=timedelta(hours=24), require_token=True)
        assert sorted(armed) == ["never", "soon"]  # "soon" is 10h out, still inside 24h

    def test_renew_route_requires_cron_secret(self, client):
        assert client.get("/api/pilot2/gmail/renew-watch").status_code == 401
        with patch.object(sync, "renew_watches", return_value={"renewed": 1, "skipped": 0, "failed": 0}):
            r = client.get(f"/api/pilot2/gmail/renew-watch?secret={CRON}")
        assert r.status_code == 200
        assert r.json()["renewed"] == 1
        # original path kept for vercel.json
        with patch.object(sync, "renew_watches", return_value={"renewed": 0, "skipped": 0, "failed": 0}):
            assert client.get(f"/api/pilot2/gmail/watch/renew?secret={CRON}").status_code == 200

    def test_poll_renewal_failure_never_breaks_poll(self, monkeypatch):
        monkeypatch.setattr(gmail, "is_live", lambda: True)
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = []
        with patch.object(sync, "renew_watches", side_effect=RuntimeError("boom")), \
                patch.object(sync, "process_ai_batch", return_value=0):
            assert pipeline.poll_all_accounts(db) == 0
