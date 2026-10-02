"""Standard reply signature for Pilot 2 email drafts."""

from __future__ import annotations

SIGNATURE_PERSON = "Andrea Petty"
SIGNATURE_COMPANY = "Power Music Inc."
LEGACY_SIGNATURE = "Kind regards,\nPower Music Team"


def build_signature(inbox_title: str | None) -> str:
    """Inbox title = connected email display name from the Email Accounts tab."""
    line = (inbox_title or "").strip() or "Power Music"
    return f"Thank you.\n\n{SIGNATURE_PERSON}\n{line}\n{SIGNATURE_COMPANY}"
