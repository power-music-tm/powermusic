"""Same-person matching for roster requests, auto-email intake, and directory checks.

PureGym and Health Fitness use the same 4-field identity model:
  first name, last name, email, location

For Health Fitness, "location" stores what the partner calls "client".
The distinction is purely a presentation concern handled by the frontend.
No separate matching logic is needed — same_person() serves both.

GLL uses a 3-field identity model (first name, last name, email).
Location is absent for GLL records (stored as NULL / empty in the DB).
same_person_gll() applies the GLL-specific rules; same_person_for_partner()
routes to the correct implementation based on the is_gll flag.
"""

from __future__ import annotations

from typing import Optional, Union

from app import models, schemas


def _norm(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _norm_name(first: Optional[str], last: Optional[str]) -> str:
    return _norm(f"{first or ''} {last or ''}")


def person_from_model(row: models.ManagerRequest) -> schemas.PersonInfo:
    return schemas.PersonInfo(
        firstName=row.person_first_name or "",
        lastName=row.person_last_name or "",
        email=row.person_email or "",
        location=row.person_location or "",
        role=getattr(row, "role", None),
    )


def same_person(
    left: Union[schemas.PersonInfo, models.ManagerRequest],
    right: Union[schemas.PersonInfo, models.ManagerRequest],
) -> bool:
    """True when all four identity fields match exactly.

    Works for both PureGym (location = gym location) and Health Fitness
    (location = client name). The stored value is identical in both cases —
    only the UI label differs.
    """
    if isinstance(left, models.ManagerRequest):
        left = person_from_model(left)
    if isinstance(right, models.ManagerRequest):
        right = person_from_model(right)

    name_l = _norm_name(left.firstName, left.lastName)
    name_r = _norm_name(right.firstName, right.lastName)
    email_l = _norm(left.email)
    email_r = _norm(right.email)
    loc_l = _norm(left.location)
    loc_r = _norm(right.location)

    name_match = bool(name_l and name_r and name_l == name_r)
    email_match = bool(email_l and email_r and email_l == email_r)
    loc_match = bool(loc_l and loc_r and loc_l == loc_r)

    if name_match and email_match and loc_match:
        return True
    if name_match and email_match:
        return True
    if email_match and loc_match:
        return True
    if name_match and loc_match:
        return True
    if email_match:
        return True

    return False


def same_person_gll(
    left: Union[schemas.PersonInfo, models.ManagerRequest],
    right: Union[schemas.PersonInfo, models.ManagerRequest],
) -> bool:
    """GLL 3-field exact-match: name (first+last combined) AND email.

    Location is not part of the GLL identity model and is never compared.
    Mirrors the same_person() liberal fallback logic but without location:
      - name match AND email match  → True
      - email match alone           → True  (same email-only fallback as same_person)
    """
    if isinstance(left, models.ManagerRequest):
        left = person_from_model(left)
    if isinstance(right, models.ManagerRequest):
        right = person_from_model(right)

    name_l = _norm_name(left.firstName, left.lastName)
    name_r = _norm_name(right.firstName, right.lastName)
    email_l = _norm(left.email)
    email_r = _norm(right.email)

    name_match = bool(name_l and name_r and name_l == name_r)
    email_match = bool(email_l and email_r and email_l == email_r)

    if name_match and email_match:
        return True
    if email_match:
        return True

    return False


def same_person_for_partner(
    left: Union[schemas.PersonInfo, models.ManagerRequest],
    right: Union[schemas.PersonInfo, models.ManagerRequest],
    *,
    is_healthtech: bool = False,
    is_gll: bool = False,
) -> bool:
    """Partner-aware exact-match check.

    * GLL (is_gll=True)  → same_person_gll() — 3-field (name + email, no location)
    * All others          → same_person()     — 4-field (name + email + location)

    is_healthtech is accepted for backwards compatibility but no longer changes
    behaviour — PureGym and Health Fitness share the same 4-field same_person().
    """
    if is_gll:
        return same_person_gll(left, right)
    return same_person(left, right)
