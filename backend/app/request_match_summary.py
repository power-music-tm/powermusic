"""Build API match summaries for linked intake sources and directory rows."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app import models
from app.directory_person_match import find_directory_conflict, request_person_for_match
from app.intake_persons import bootstrap_intake_persons, get_auto_mail_snapshot, get_partner_snapshot
from app.person_compare import compare_person_fields, person_from_mapping, person_to_mapping
from app.person_match import person_from_model


def find_directory_match(
    req: models.ManagerRequest,
    directory_rows: List[models.ManagerRequest],
) -> Optional[models.ManagerRequest]:
    person = request_person_for_match(req)
    return find_directory_conflict(
        person=person,
        action=req.action or "",
        directory_rows=directory_rows,
    )


def build_intake_match(req: models.ManagerRequest) -> Optional[Dict[str, Any]]:
    bootstrap_intake_persons(req)
    partner = get_partner_snapshot(req)
    auto_mail = get_auto_mail_snapshot(req)
    if not partner or not auto_mail:
        return None

    comparison = compare_person_fields(
        partner,
        auto_mail,
        left_label="Manager request",
        right_label="Automated email",
    )
    return {
        "kind": "intake",
        "allMatch": comparison["allMatch"],
        "summary": comparison["summary"],
        "fields": comparison["fields"],
    }


def build_directory_match(
    req: models.ManagerRequest,
    directory_row: Optional[models.ManagerRequest],
) -> Optional[Dict[str, Any]]:
    if directory_row is None:
        return None

    request_person = request_person_for_match(req)
    directory_person = person_from_model(directory_row)
    comparison = compare_person_fields(
        request_person,
        directory_person,
        left_label="This request",
        right_label="Directory",
    )
    return {
        "kind": "directory",
        "allMatch": comparison["allMatch"],
        "summary": comparison["summary"],
        "fields": comparison["fields"],
        "directoryId": directory_row.id,
        "directoryName": f"{directory_row.person_first_name} {directory_row.person_last_name}".strip(),
        "directoryStatus": directory_row.outcome or "",
    }
