"""Unit tests: request_display + display assign helpers (no DB)."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from app.display import assign_display_ids
from app.request_display import parse_request_display_number


class TestParseRequestDisplayNumber:
    def test_parses_padded(self):
        assert parse_request_display_number("req-001") == 1
        assert parse_request_display_number("REQ-027") == 27

    def test_invalid(self):
        assert parse_request_display_number(None) == 0
        assert parse_request_display_number("") == 0
        assert parse_request_display_number("r-01") == 0
        assert parse_request_display_number("req-abc") == 0


class TestAssignDisplayIds:
    def test_groups_by_status_newest_first(self):
        older = datetime(2024, 1, 1, tzinfo=timezone.utc)
        newer = datetime(2025, 1, 1, tzinfo=timezone.utc)
        items = [
            SimpleNamespace(status="new", created_at=older),
            SimpleNamespace(status="new", created_at=newer),
            SimpleNamespace(status="handled", created_at=newer),
        ]
        assign_display_ids(items, status_attr="status", date_attr="created_at")
        new_items = [i for i in items if i.status == "new"]
        by_date = sorted(new_items, key=lambda i: i.created_at, reverse=True)
        assert by_date[0].created_at == newer
        assert by_date[0].displayId == 1
        assert by_date[1].displayId == 2
        handled = next(i for i in items if i.status == "handled")
        assert handled.displayId == 1
