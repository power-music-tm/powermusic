"""Best-effort Realtime nudge when the admin New Requests queue changes."""

from app.pilot2 import realtime


def notify_admin_requests_changed(source: str) -> None:
    realtime.requests_changed(source)
