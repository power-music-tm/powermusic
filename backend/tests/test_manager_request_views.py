"""Unit tests for manager request unread helpers."""

from datetime import datetime, timezone

from app import models
from app.manager_request_views import is_request_unread


def _handled_request(handled_at: datetime) -> models.ManagerRequest:
    return models.ManagerRequest(
        id="req-1",
        received_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        handled_at=handled_at,
        person_first_name="Ann",
        person_last_name="Lee",
        person_email="ann@example.com",
        person_location="London",
        action="Add",
        status="handled",
        outcome="Added",
        tags=["verified"],
    )


def test_unread_when_never_seen():
    req = _handled_request(datetime(2026, 7, 5, tzinfo=timezone.utc))
    assert is_request_unread(req, None) is True


def test_read_after_seen_at_or_after_handled():
    handled_at = datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)
    req = _handled_request(handled_at)
    assert is_request_unread(req, handled_at) is False
    assert is_request_unread(req, handled_at.replace(hour=13)) is False


def test_unread_when_seen_before_handled():
    handled_at = datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)
    req = _handled_request(handled_at)
    seen_at = datetime(2026, 7, 4, tzinfo=timezone.utc)
    assert is_request_unread(req, seen_at) is True


def test_pending_request_is_never_unread():
    req = models.ManagerRequest(
        id="req-2",
        received_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        person_first_name="Bob",
        person_last_name="Smith",
        person_email="bob@example.com",
        person_location="Leeds",
        action="Remove",
        status="new",
        tags=["verified"],
    )
    assert is_request_unread(req, None) is False
