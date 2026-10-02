"""Andrea-managed sender blocklist — hide matching mail from Email responses."""

from __future__ import annotations

from typing import Iterable, List, Optional, Tuple

from sqlalchemy.orm import Session

from app import models


def parse_ignore_pattern(raw: str) -> Tuple[str, str]:
    """Return (kind, pattern) where kind is 'email' or 'domain'."""
    value = (raw or "").strip().lower()
    if not value:
        raise ValueError("Enter an email address or domain.")

    if value.startswith("@"):
        domain = value[1:].strip().lstrip("@")
        if not domain or "@" in domain or " " in domain:
            raise ValueError("Enter a valid domain like @company.com.")
        return "domain", domain

    if "@" in value:
        if value.count("@") != 1 or value.startswith("@") or value.endswith("@"):
            raise ValueError("Enter a valid email address.")
        local, domain = value.split("@", 1)
        if not local or not domain or " " in value:
            raise ValueError("Enter a valid email address.")
        return "email", value

    if " " in value or "/" in value:
        raise ValueError("Enter a valid domain like company.com or @company.com.")
    return "domain", value


def sender_matches_rule(from_email: str, kind: str, pattern: str) -> bool:
    addr = (from_email or "").strip().lower()
    if not addr:
        return False
    if kind == "email":
        return addr == pattern
    return addr == f"@{pattern}" or addr.endswith(f"@{pattern}")


def is_sender_ignored(from_email: str, account_email: str, rules: Iterable[models.EmailIgnoreRule]) -> bool:
    inbox = (account_email or "").lower()
    for rule in rules:
        if (rule.account_email or "").lower() != inbox:
            continue
        if sender_matches_rule(from_email, rule.kind, rule.pattern):
            return True
    return False


def is_message_ignored(
    from_email: str,
    account_email: str,
    rules: Iterable[models.EmailIgnoreRule],
    *,
    original_from_email: Optional[str] = None,
) -> bool:
    for addr in (from_email, original_from_email):
        if addr and is_sender_ignored(addr, account_email, rules):
            return True
    return False


def is_email_ignored(email: models.Email, rules: Iterable[models.EmailIgnoreRule]) -> bool:
    return is_message_ignored(
        email.from_email,
        email.account_email,
        rules,
        original_from_email=email.original_from_email,
    )


def load_rules_for_inbox(db: Session, account_email: str) -> List[models.EmailIgnoreRule]:
    return (
        db.query(models.EmailIgnoreRule)
        .filter(models.EmailIgnoreRule.account_email == account_email)
        .order_by(models.EmailIgnoreRule.created_at.desc())
        .all()
    )


def load_rules_grouped(db: Session) -> dict[str, List[models.EmailIgnoreRule]]:
    grouped: dict[str, List[models.EmailIgnoreRule]] = {}
    for rule in db.query(models.EmailIgnoreRule).all():
        grouped.setdefault(rule.account_email, []).append(rule)
    return grouped


def filter_emails_by_ignore_list(
    emails: Iterable[models.Email],
    rules_by_inbox: dict[str, List[models.EmailIgnoreRule]],
) -> List[models.Email]:
    kept: List[models.Email] = []
    for email in emails:
        rules = rules_by_inbox.get(email.account_email, [])
        if rules and is_email_ignored(email, rules):
            continue
        kept.append(email)
    return kept


def count_inbox_tab_emails(
    db: Session,
    *,
    account_emails: Optional[Iterable[str]] = None,
) -> int:
    """Emails on the Inbox tab in Email responses (per-inbox rules, summed when scoped)."""
    visible = models.Email.draft_status.notin_(["Ignored", "Imported", "Processing"])
    query = (
        db.query(models.Email)
        .filter(visible, models.Email.deleted.is_(False))
        .filter(
            models.Email.archived.is_(False),
            models.Email.draft_status != "Sent",
        )
    )
    if account_emails is not None:
        scoped = set(account_emails)
        if not scoped:
            return 0
        query = query.filter(models.Email.account_email.in_(scoped))
    rows = query.all()
    return len(filter_emails_by_ignore_list(rows, load_rules_grouped(db)))


def list_flagged_workspace_emails(db: Session) -> List[models.Email]:
    """Flagged emails visible in Email responses (workspace + flagged tab rules)."""
    visible = models.Email.draft_status.notin_(["Ignored", "Imported", "Processing"])
    rows = (
        db.query(models.Email)
        .filter(visible, models.Email.deleted.is_(False))
        .filter(models.Email.flagged.is_(True), models.Email.archived.is_(False))
        .order_by(models.Email.received_at.desc())
        .all()
    )
    return filter_emails_by_ignore_list(rows, load_rules_grouped(db))
