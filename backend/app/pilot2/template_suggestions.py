"""Create template suggestions from Andrea's sends and distiller revisions."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app import models

_MIN_REPLY_CHARS = 80
_SUBJECT_PREFIX_RE = re.compile(r"^(re|fwd|fw):\s*", re.IGNORECASE)


def clean_email_subject(subject: str) -> str:
    text = (subject or "").strip()
    while True:
        match = _SUBJECT_PREFIX_RE.match(text)
        if not match:
            break
        text = text[match.end() :].strip()
    return text or "General enquiry"


_INTENT_TEMPLATE_NAMES = {
    "Events": "Event Reply",
    "Enquiry": "Enquiry Reply",
    "Cancellation": "Cancellation Reply",
    "Renewal": "Renewal Reply",
    "Finance": "Payment Reply",
    "Partnership": "Partnership Reply",
}


def suggest_template_name(intent: str | None, subject: str) -> str:
    label = (intent or "Enquiry").strip()
    if label in _INTENT_TEMPLATE_NAMES:
        return _INTENT_TEMPLATE_NAMES[label]
    clean = clean_email_subject(subject)
    snippet = clean[:48].strip() or "Reply"
    return f"{label}: {snippet}"


def _guidance_rules_for_intent(db: Session, intent: str | None) -> list[str]:
    note = (
        db.query(models.GuidanceNote)
        .filter(models.GuidanceNote.intent == (intent or "Enquiry"))
        .first()
    )
    if note is None or not note.rules:
        return []
    return [str(rule).strip() for rule in note.rules if str(rule).strip()]


def _build_new_template_rationale(email: models.Email, guidance_rules: list[str]) -> str:
    lines = [
        "Andrea sent this reply without a matching template.",
        f"Source email: {clean_email_subject(email.subject)}",
    ]
    if guidance_rules:
        lines.append("Drafting instructions learned from your past edits for this intent:")
        lines.extend(f"• {rule}" for rule in guidance_rules[:5])
    return "\n".join(lines)


def suggest_template_subject(subject: str) -> str:
    clean = clean_email_subject(subject)
    return clean[:200]


def _reply_is_substantial(final_body: str) -> bool:
    return len((final_body or "").strip()) >= _MIN_REPLY_CHARS


def maybe_suggest_new_template(
    db: Session,
    email: models.Email,
    final_body: str,
) -> bool:
    """Queue a new-template suggestion when Andrea sent a reply with no template match."""
    if email.template_ids:
        return False
    if not _reply_is_substantial(final_body):
        return False

    existing = (
        db.query(models.TemplateSuggestion)
        .filter(
            models.TemplateSuggestion.kind == "new",
            models.TemplateSuggestion.source_email_id == email.id,
            models.TemplateSuggestion.status == "pending",
        )
        .first()
    )
    if existing:
        return False

    guidance_rules = _guidance_rules_for_intent(db, email.intent)
    now = datetime.now(timezone.utc)
    db.add(
        models.TemplateSuggestion(
            kind="new",
            template_id=None,
            source_email_id=email.id,
            account_email=email.account_email,
            intent=email.intent or "Enquiry",
            suggested_name=suggest_template_name(email.intent, email.subject),
            suggested_subject=suggest_template_subject(email.subject),
            suggested_body=final_body.strip(),
            rationale=_build_new_template_rationale(email, guidance_rules),
            status="pending",
            created_at=now,
        )
    )
    return True
