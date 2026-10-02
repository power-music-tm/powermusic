"""Tests for Gmail label derivation (no API or database)."""

from app.pilot2 import gmail
from app.pilot2 import gmail_labels


class TestDeriveLabelFlags:
    def test_inbox_unread_inbound(self):
        flags = gmail_labels.derive_label_flags(
            [gmail.LABEL_INBOX, gmail.LABEL_UNREAD],
            account_email="inbox@example.com",
            from_email="customer@example.com",
        )
        assert flags["gmail_in_inbox"] is True
        assert flags["gmail_archived"] is False
        assert flags["gmail_is_outbound"] is False

    def test_archived_inbound(self):
        flags = gmail_labels.derive_label_flags(
            [],
            account_email="inbox@example.com",
            from_email="customer@example.com",
        )
        assert flags["gmail_archived"] is True
        assert flags["gmail_in_inbox"] is False

    def test_sent_is_outbound_not_archived(self):
        flags = gmail_labels.derive_label_flags(
            [gmail.LABEL_SENT],
            account_email="inbox@example.com",
            from_email="inbox@example.com",
        )
        assert flags["gmail_is_outbound"] is True
        assert flags["gmail_in_sent"] is True
        assert flags["gmail_archived"] is False

    def test_trash_not_archived(self):
        flags = gmail_labels.derive_label_flags(
            [gmail.LABEL_TRASH],
            account_email="inbox@example.com",
            from_email="customer@example.com",
        )
        assert flags["gmail_in_trash"] is True
        assert flags["gmail_archived"] is False

    def test_merge_label_delta(self):
        merged = gmail_labels.merge_label_delta(
            ["INBOX", "UNREAD"],
            added=["STARRED"],
            removed=["UNREAD"],
        )
        assert merged == ["INBOX", "STARRED"]
