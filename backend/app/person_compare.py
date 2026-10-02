"""Field-level person comparison for intake and directory match display.

Both PureGym and Health Fitness share the same 4-field identity model:
  first name, last name, email, location

For Health Fitness, "location" is presented as "client" in the UI.
This presentation distinction is handled by the frontend based on partner_id.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from app import models, schemas


def _norm(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _norm_name(first: Optional[str], last: Optional[str]) -> str:
    return _norm(f"{first or ''} {last or ''}")


def _display_name(first: Optional[str], last: Optional[str]) -> str:
    return f"{first or ''} {last or ''}".strip()


def person_from_mapping(data: Optional[Dict[str, Any]]) -> Optional[schemas.PersonInfo]:
    if not data:
        return None
    return schemas.PersonInfo(
        firstName=data.get("firstName") or "",
        lastName=data.get("lastName") or "",
        email=data.get("email") or "",
        location=data.get("location") or "",
        role=data.get("role") or None,
    )


def person_to_mapping(person: Union[schemas.PersonInfo, models.ManagerRequest]) -> Dict[str, str]:
    if isinstance(person, models.ManagerRequest):
        res = {
            "firstName": person.person_first_name or "",
            "lastName": person.person_last_name or "",
            "email": person.person_email or "",
            "location": person.person_location or "",
        }
        if getattr(person, "role", None):
            res["role"] = person.role
        return res
    res = {
        "firstName": person.firstName or "",
        "lastName": person.lastName or "",
        "email": person.email or "",
        "location": person.location or "",
    }
    if getattr(person, "role", None):
        res["role"] = person.role
    return res


def compare_person_fields(
    left: Union[schemas.PersonInfo, Dict[str, Any], models.ManagerRequest],
    right: Union[schemas.PersonInfo, Dict[str, Any], models.ManagerRequest],
    *,
    left_label: str = "left",
    right_label: str = "right",
) -> Dict[str, Any]:
    if isinstance(left, dict):
        left = person_from_mapping(left)
    if isinstance(right, dict):
        right = person_from_mapping(right)
    if left is None or right is None:
        return {"allMatch": True, "summary": "All same", "fields": []}

    name_l = _norm_name(left.firstName, left.lastName)
    name_r = _norm_name(right.firstName, right.lastName)
    email_l = _norm(left.email)
    email_r = _norm(right.email)
    loc_l = _norm(left.location)
    loc_r = _norm(right.location)

    role_l = _norm(getattr(left, "role", None))
    role_r = _norm(getattr(right, "role", None))

    fields: List[Dict[str, Any]] = [
        {
            "field": "name",
            "label": "Name",
            "status": "same" if name_l == name_r else "differs",
            "leftValue": _display_name(left.firstName, left.lastName),
            "rightValue": _display_name(right.firstName, right.lastName),
            "leftLabel": left_label,
            "rightLabel": right_label,
        },
        {
            "field": "email",
            "label": "Email",
            "status": "same" if email_l == email_r else "differs",
            "leftValue": left.email or "",
            "rightValue": right.email or "",
            "leftLabel": left_label,
            "rightLabel": right_label,
        },
        {
            "field": "location",
            # label is "Location" for PureGym, "Client" for Health Fitness —
            # the frontend applies the correct label based on partner context.
            "label": "Location",
            "status": "same" if loc_l == loc_r else "differs",
            "leftValue": left.location or "",
            "rightValue": right.location or "",
            "leftLabel": left_label,
            "rightLabel": right_label,
        },
    ]

    if role_l or role_r:
        fields.append(
            {
                "field": "role",
                "label": "Role",
                "status": "same" if role_l == role_r else "differs",
                "leftValue": getattr(left, "role", None) or "",
                "rightValue": getattr(right, "role", None) or "",
                "leftLabel": left_label,
                "rightLabel": right_label,
            }
        )

    all_match = all(item["status"] == "same" for item in fields)
    summary = "All same" if all_match else _build_summary(fields)
    return {"allMatch": all_match, "summary": summary, "fields": fields}


def _build_summary(fields: List[Dict[str, Any]]) -> str:
    parts = []
    for item in fields:
        short = item["label"].lower()
        parts.append(f"{short} {'same' if item['status'] == 'same' else 'differs'}")
    return " · ".join(parts)
