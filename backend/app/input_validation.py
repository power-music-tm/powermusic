"""Shared input validation for API payloads (form abuse, injection, DoS)."""

from __future__ import annotations

import re
import unicodedata
from typing import Optional

# Control characters and null bytes — common in injection / log-forging attempts
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_HTML_TAG = re.compile(r"<[^>]+>")
_NAME_ALLOWED_EXTRA = {" ", "'", ".", "-"}
_ROSTER_NAME_MIN_LENGTH = 2
_ROSTER_LOCATION_MIN_LENGTH = 2


def strip_control_chars(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = _CONTROL_CHARS.sub("", value)
    return cleaned.strip() or None


def _reject_html(value: str, field_name: str) -> None:
    if _HTML_TAG.search(value):
        raise ValueError(f"{field_name} must not contain HTML")


def _is_letter_or_mark(char: str) -> bool:
    if not char:
        return False
    category = unicodedata.category(char)
    return category.startswith("L") or category == "Mn"


def _is_valid_person_name(value: str) -> bool:
    if not value or len(value) > 100:
        return False
    if not _is_letter_or_mark(value[0]):
        return False
    for char in value:
        if char in _NAME_ALLOWED_EXTRA:
            continue
        if not _is_letter_or_mark(char):
            return False
    return True


def normalize_text(
    value: Optional[str],
    *,
    max_length: int,
    allow_empty: bool = False,
    field_name: str = "value",
    reject_html: bool = False,
) -> Optional[str]:
    if value is None:
        return None if allow_empty else ""
    cleaned = strip_control_chars(str(value))
    if cleaned is None:
        return None if allow_empty else ""
    if not cleaned and not allow_empty:
        raise ValueError(f"{field_name} is required")
    if len(cleaned) > max_length:
        raise ValueError(f"{field_name} must be at most {max_length} characters")
    if reject_html:
        _reject_html(cleaned, field_name)
    return cleaned


def normalize_email(value: Optional[str], *, required: bool = False) -> Optional[str]:
    cleaned = normalize_text(
        value,
        max_length=254,
        allow_empty=not required,
        field_name="email",
    )
    if cleaned is None:
        return None
    if not _EMAIL_RE.match(cleaned):
        raise ValueError("invalid email format")
    return cleaned.lower()


def _is_valid_roster_person_name(value: str) -> bool:
    return (
        _ROSTER_NAME_MIN_LENGTH <= len(value) <= 100
        and all(_is_letter_or_mark(char) for char in value)
    )


def _is_valid_roster_person_location(value: str) -> bool:
    if not (_ROSTER_LOCATION_MIN_LENGTH <= len(value) <= 200):
        return False
    for char in value:
        if char == " ":
            continue
        if not _is_letter_or_mark(char):
            return False
    return True


def normalize_roster_person_name(
    value: Optional[str],
    *,
    field_name: str = "name",
    required: bool = False,
) -> Optional[str]:
    cleaned = normalize_text(
        value,
        max_length=100,
        allow_empty=not required,
        field_name=field_name,
        reject_html=True,
    )
    if cleaned is None:
        return None
    if not _is_valid_roster_person_name(cleaned):
        raise ValueError(
            f"{field_name} must be at least {_ROSTER_NAME_MIN_LENGTH} characters "
            "and contain letters only (no numbers, spaces, or symbols)."
        )
    return cleaned


def normalize_roster_person_location(
    value: Optional[str],
    *,
    field_name: str = "location",
    required: bool = False,
) -> Optional[str]:
    cleaned = normalize_text(
        value,
        max_length=200,
        allow_empty=not required,
        field_name=field_name,
        reject_html=True,
    )
    if cleaned is None:
        return None
    if not _is_valid_roster_person_location(cleaned):
        raise ValueError(
            f"{field_name} must be at least {_ROSTER_LOCATION_MIN_LENGTH} characters "
            "and contain letters and spaces only (no numbers or symbols)."
        )
    return cleaned


def normalize_person_name(
    value: Optional[str],
    *,
    field_name: str = "name",
    required: bool = False,
) -> Optional[str]:
    cleaned = normalize_text(
        value,
        max_length=100,
        allow_empty=not required,
        field_name=field_name,
        reject_html=True,
    )
    if cleaned is None:
        return None
    if not _is_valid_person_name(cleaned):
        raise ValueError(
            f"{field_name} may only contain letters, spaces, hyphens, and apostrophes."
        )
    return cleaned


def normalize_club_label(value: Optional[str], *, field_name: str = "club") -> Optional[str]:
    cleaned = normalize_text(
        value,
        max_length=200,
        allow_empty=True,
        field_name=field_name,
        reject_html=True,
    )
    return cleaned


def normalize_person_location(
    value: Optional[str],
    *,
    field_name: str = "location",
    required: bool = False,
    min_length: int = 2,
) -> Optional[str]:
    """Legacy helper — prefer normalize_roster_person_location for roster users."""
    return normalize_roster_person_location(
        value,
        field_name=field_name,
        required=required,
    )


def normalize_person_notes(
    value: Optional[str],
    *,
    field_name: str = "notes",
) -> Optional[str]:
    return normalize_text(
        value,
        max_length=5000,
        allow_empty=True,
        field_name=field_name,
        reject_html=True,
    )



def normalize_search_query(value: str, *, max_length: int = 100) -> str:
    cleaned = normalize_text(value, max_length=max_length, allow_empty=True, field_name="query")
    return cleaned or ""


def csv_cell(value: object) -> str:
    """Escape CSV cells and block spreadsheet formula injection (=, +, -, @)."""
    text = "" if value is None else str(value)
    text = text.replace('"', '""')
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        text = f"'{text}"
    return f'"{text}"'
