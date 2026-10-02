"""Email processing pipeline: ingest → classify → compose → persist.

This is the single entry point for new mail whether it arrives from the Gmail
poller or the /ingest endpoint, so both paths behave identically.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app import models
from app.pilot2 import config, gmail
from app.pilot2.ai import classifier, composer
from app.pilot2.signature import build_signature

logger = logging.getLogger(__name__)


def next_id(db: Session, model, prefix: str) -> str:
    max_num = 0
    for (row_id,) in db.query(model.id).all():
        if row_id and row_id.startswith(f"{prefix}-"):
            try:
                max_num = max(max_num, int(row_id.split("-")[1]))
            except ValueError:
                pass
    return f"{prefix}-{max_num + 1:03d}"


def log(db: Session, type_: str, description: str, email_id: Optional[str] = None) -> None:
    db.add(models.ProcessingLog(
        timestamp=datetime.now(timezone.utc),
        type=type_,
        description=description,
        email_id=email_id,
    ))


def known_intent_names(db: Session) -> list:
    """Every intent the system knows: the seed list plus any the AI has already
    named on an email or template. New intents auto-persist here — once a novel
    intent is stored on an email, it is a known intent for every later email."""
    names: dict = {name: None for name in config.INTENTS}
    for source in (models.Email.intent, models.EmailTemplate.intent):
        for (value,) in db.query(source).filter(source.isnot(None)).distinct():
            cleaned = (value or "").strip()
            if cleaned:
                names.setdefault(cleaned, None)
    return list(names.keys())


def persist_attachments(db: Session, email_id: str, attachments) -> None:
    """Store attachment metadata rows for an email.

    Accepts gmail.InboundAttachment instances (from live/import parsing) or
    plain dicts (manual ingest for testing). Bytes are only stored inline when
    already present; live Gmail bytes are fetched on demand at download time.
    """
    if not attachments:
        return
    for index, att in enumerate(attachments):
        if isinstance(att, dict):
            filename = att.get("filename")
            mime_type = att.get("mimeType") or att.get("mime_type")
            size_bytes = att.get("sizeBytes") or att.get("size_bytes") or 0
            gmail_attachment_id = att.get("gmailAttachmentId") or att.get("gmail_attachment_id")
            content_base64 = att.get("contentBase64") or att.get("content_base64")
            is_inline = bool(att.get("isInline") or att.get("is_inline") or False)
            content_id = att.get("contentId") or att.get("content_id")
        else:
            filename = att.filename
            mime_type = att.mime_type
            size_bytes = att.size_bytes
            gmail_attachment_id = att.gmail_attachment_id
            content_base64 = att.content_base64
            is_inline = att.is_inline
            content_id = att.content_id

        db.add(models.EmailAttachment(
            id=f"{email_id}-att-{index + 1:02d}",
            email_id=email_id,
            filename=filename or "attachment",
            mime_type=mime_type or "application/octet-stream",
            size_bytes=int(size_bytes or 0),
            gmail_attachment_id=gmail_attachment_id,
            content_base64=content_base64,
            is_inline=is_inline,
            content_id=content_id,
        ))


def process_incoming(
    db: Session,
    *,
    account_email: str,
    from_name: str,
    from_email: str,
    subject: str,
    body: str,
    received_at: Optional[datetime] = None,
    gmail_message_id: Optional[str] = None,
    gmail_thread_id: Optional[str] = None,
    label_ids: Optional[list] = None,
    to_emails: Optional[list] = None,
    cc_emails: Optional[list] = None,
    html_body: Optional[str] = None,
    snippet: Optional[str] = None,
    message_id_header: Optional[str] = None,
    in_reply_to_header: Optional[str] = None,
    references_header: Optional[str] = None,
    is_forward: bool = False,
    forwarded_by_name: Optional[str] = None,
    forwarded_by_email: Optional[str] = None,
    original_from_name: Optional[str] = None,
    original_from_email: Optional[str] = None,
    attachments: Optional[list] = None,
) -> models.Email:
    """Run one inbound email through the full pipeline and persist it.

    Idempotent per Gmail message: the scheduler and the manual poll endpoint
    can race, so a message that is already stored is returned as-is.
    """
    if gmail_message_id:
        existing = (
            db.query(models.Email)
            .filter(models.Email.gmail_message_id == gmail_message_id)
            .first()
        )
        if existing:
            if existing.draft_status == "Imported":
                return run_ai_for_email(db, existing)
            return existing

    from app.automated_person_intake import intake_puregym_roster_message

    if intake_puregym_roster_message(
        db,
        from_email=from_email,
        from_name=from_name,
        subject=subject,
        body=body,
        received_at=received_at or datetime.now(timezone.utc),
        gmail_message_id=gmail_message_id,
        inbox_email=account_email,
    ):
        email = models.Email(
            id=next_id(db, models.Email, "email"),
            account_email=account_email,
            gmail_message_id=gmail_message_id,
            gmail_thread_id=gmail_thread_id,
            from_name=from_name,
            from_email=from_email,
            subject=subject,
            body=body,
            received_at=received_at or datetime.now(timezone.utc),
            draft_status="Ignored",
            archived=True,
            read=True,
        )
        if label_ids is not None:
            from app.pilot2 import gmail_labels

            flags = gmail_labels.derive_label_flags(
                label_ids,
                account_email=account_email,
                from_email=from_email,
            )
            gmail_labels.apply_label_flags(email, flags)
        db.add(email)
        log(
            db,
            "automated_intake",
            f"Roster email → manager request from {from_email}.",
            email.id,
        )
        db.commit()
        db.refresh(email)
        from app.partner_requests_realtime import notify_admin_requests_changed

        notify_admin_requests_changed("auto_mail")
        return email

    email = models.Email(
        id=next_id(db, models.Email, "email"),
        account_email=account_email,
        gmail_message_id=gmail_message_id,
        gmail_thread_id=gmail_thread_id,
        from_name=from_name,
        from_email=from_email,
        to_emails=list(to_emails or []),
        cc_emails=list(cc_emails or []),
        subject=subject,
        body=body,
        html_body=html_body,
        snippet=snippet,
        received_at=received_at or datetime.now(timezone.utc),
        message_id_header=message_id_header,
        in_reply_to_header=in_reply_to_header,
        references_header=references_header,
        is_forward=is_forward,
        forwarded_by_name=forwarded_by_name,
        forwarded_by_email=forwarded_by_email,
        original_from_name=original_from_name,
        original_from_email=original_from_email,
        draft_status="Processing",
    )
    if label_ids is not None:
        from app.pilot2 import gmail_labels

        flags = gmail_labels.derive_label_flags(
            label_ids,
            account_email=account_email,
            from_email=from_email,
        )
        gmail_labels.apply_label_flags(email, flags)
    db.add(email)
    db.flush()
    persist_attachments(db, email.id, attachments)

    return run_ai_for_email(db, email)


def run_ai_for_email(db: Session, email: models.Email) -> models.Email:
    """Classify and compose a draft for one stored email row."""
    if email.draft_status == "No Draft":
        return email
    if email.draft_status not in ("Imported", "Processing") and email.draft_body:
        return email

    # Nobody can answer a no-reply sender, so composing a draft is pure
    # waste. Import normally filters these; this guard covers every other
    # path an email can take into the AI queue.
    from app.pilot2.sync import _is_no_reply_sender

    if _is_no_reply_sender(email.from_email):
        email.draft_status = "Ignored"
        email.archived = True
        email.read = True
        email.flagged = False
        email.flag_reason = None
        log(db, "email_ignored", f"Ignored no-reply sender {email.from_email}.", email.id)
        db.commit()
        db.refresh(email)
        return email

    templates = (
        db.query(models.EmailTemplate)
        .filter(
            models.EmailTemplate.status == "Active",
            models.EmailTemplate.account_email == email.account_email,
        )
        .all()
    )

    known_before = known_intent_names(db)
    # Release the DB backend during the classify LLM call — holding a
    # transaction idle while waiting on the model starves other requests (e.g.
    # the dashboard's /workspace) of a pooled connection.
    db.commit()
    classification = classifier.classify(
        email.from_name,
        email.from_email,
        email.subject,
        email.body,
        templates,
        known_intents=known_before,
    )

    # Storing the (possibly brand-new) intent on the email is what "creates" it:
    # known_intent_names() reads it back for the next email, so a novel intent
    # the AI names once becomes a known intent thereafter (auto-created).
    email.intent = classification.intent
    email.intent_confidence = classification.confidence
    email.language = classification.language
    email.sender_first_name = classification.sender_first_name
    email.urgent = classification.urgent

    # Deterministic urgency: a customer who has sent several messages on the
    # same thread is chasing us for a reply — flag urgent regardless of the AI's
    # tone read. Counts this sender's own messages in the thread (our replies
    # have a different from_email and are excluded). The current email is
    # already persisted, so it is included in the count.
    if not email.urgent and email.gmail_thread_id and email.from_email:
        thread_messages = (
            db.query(models.Email)
            .filter(
                models.Email.gmail_thread_id == email.gmail_thread_id,
                models.Email.from_email == email.from_email,
            )
            .count()
        )
        if thread_messages >= config.URGENT_FOLLOWUP_THRESHOLD:
            email.urgent = True

    if classification.should_ignore:
        email.draft_status = "Ignored"
        email.archived = True
        email.read = True
        log(db, "email_ignored", f"Ignored email from {email.from_email} (spam/noise).", email.id)
        db.commit()
        db.refresh(email)
        return email

    templates_by_id = {t.id: t for t in templates}
    # Template matching, best signal first:
    # 1. Semantic (embedding) similarity — reliable, ignores the intent label,
    #    doesn't need a live generation call.
    # 2. Whatever the classifier matched (LLM library match, or lexical when the
    #    model was down).
    # 3. Pure lexical keyword overlap — last-resort, still no model needed.
    from app.pilot2.ai import embeddings

    # Persist the classification and release the backend before the embedding
    # call (another model round-trip) for the same reason as classify.
    db.commit()

    # Semantic match requires a CLEAR winner (see embeddings.semantic_match), so
    # a strong match is used even for a newly-named intent ("Order Timing" ->
    # order-time template), while a poorly-fitting email returns [] -> holding
    # reply + on-send template suggestion. When embeddings work, that result is
    # AUTHORITATIVE (a generic template must not absorb a bad fit). Only when
    # embeddings are unavailable (None) do we fall back to the classifier's
    # match, then a lexical keyword match.
    semantic = embeddings.semantic_match_template_ids(
        db, email.account_email, email.subject, email.body
    )
    if semantic is not None:
        matched_ids = [tid for tid in semantic if tid in templates_by_id]
    else:
        matched_ids = [tid for tid in classification.template_ids if tid in templates_by_id]
        if not matched_ids:
            matched_ids = [
                tid
                for tid in classifier.match_templates_by_keywords(email.subject, email.body, templates)
                if tid in templates_by_id
            ]
    matched = [templates_by_id[tid] for tid in matched_ids]

    translations_by_template = {}
    if matched and classification.language != "en":
        rows = (
            db.query(models.TemplateTranslation)
            .filter(
                models.TemplateTranslation.template_id.in_([t.id for t in matched]),
                models.TemplateTranslation.language == classification.language,
                models.TemplateTranslation.reviewed.is_(True),
            )
            .all()
        )
        translations_by_template = {(r.template_id, r.language): r for r in rows}

    note = (
        db.query(models.GuidanceNote)
        .filter(models.GuidanceNote.intent == classification.intent)
        .first()
    )
    guidance_rules = list(note.rules) if note else []

    account = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.email == email.account_email)
        .first()
    )
    signature = build_signature(account.title if account else email.account_email)

    # Spam/noise was filtered out above (should_ignore), so this is a real
    # enquiry. Surface it to the dashboard NOW — before the slower compose step
    # — so it appears in ~2s with a "drafting…" state instead of only after the
    # full reply is written (~several seconds later). The draft fills in when
    # compose finishes and the batch broadcasts its own nudge.
    email.draft_status = "Drafting"
    db.commit()
    try:
        from app.pilot2 import realtime

        realtime.workspace_changed("classified", 1)
    except Exception:
        logger.exception("Realtime nudge after classification failed for %s", email.id)

    draft = composer.compose(
        email.body,
        email.subject,
        classification,
        matched,
        translations_by_template,
        guidance_rules,
        signature=signature,
    )

    email.template_ids = [t.id for t in matched]
    email.template_used = matched[0].name if matched else None
    email.draft_body = draft.body
    email.draft_tweak_level = draft.tweak_level

    if classification.flag or draft.tweak_level == "fallback":
        email.flagged = True
        email.flag_reason = classification.flag_reason or "No suitable template found"
        email.draft_status = "Flagged"
        log(db, "email_flagged", f"Flagged: {email.flag_reason}", email.id)
    else:
        email.draft_status = "Draft Created"

    for t in matched:
        t.times_used += 1

    log(
        db, "draft_created",
        f"Draft ({draft.tweak_level}) created for '{email.subject}'. Intent "
        f"{classification.intent} at {classification.confidence}% confidence.",
        email.id,
    )
    db.commit()
    db.refresh(email)
    return email


def sync_flags_to_gmail(db: Session, emails: list, *, read=None, archived=None, deleted=None) -> None:
    """Mirror dashboard state changes onto the real Gmail messages.

    Best-effort: a Gmail hiccup must never break the dashboard action, so
    failures are logged and the local change stands (the next action or
    reconnect converges the states).
    """
    if not gmail.is_live():
        return

    by_account = {}
    for email in emails:
        if email.gmail_message_id:
            by_account.setdefault(email.account_email, []).append(email)
    if not by_account:
        return

    accounts = {
        a.email: a
        for a in db.query(models.EmailAccount)
        .filter(models.EmailAccount.email.in_(by_account.keys()),
                models.EmailAccount.status == "Connected")
        .all()
    }
    for account_email, rows in by_account.items():
        account = accounts.get(account_email)
        if account is None:
            continue
        message_ids = [r.gmail_message_id for r in rows]
        try:
            if read is not None:
                # Gmail models "unread" as a label; read=True removes it.
                add, remove = ([], ["UNREAD"]) if read else (["UNREAD"], [])
                gmail.modify_labels_batch(account, message_ids, add, remove)
            if archived is not None:
                # Archiving in Gmail = removing the INBOX label.
                add, remove = ([], ["INBOX"]) if archived else (["INBOX"], [])
                gmail.modify_labels_batch(account, message_ids, add, remove)
            if deleted is not None:
                for mid in message_ids:
                    if deleted:
                        gmail.trash_message(account, mid)
                    else:
                        gmail.untrash_message(account, mid)
        except Exception:
            logger.exception("Gmail sync failed for %s", account_email)
            log(db, "gmail_sync_failed",
                f"Could not mirror a change to Gmail for {account_email}.")


def delete_forever_in_gmail(db: Session, email: models.Email) -> None:
    """Permanently remove the message from Gmail (used by bin actions)."""
    if not gmail.is_live() or not email.gmail_message_id:
        return
    account = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.email == email.account_email,
                models.EmailAccount.status == "Connected")
        .first()
    )
    if account is None:
        return
    try:
        gmail.delete_message_forever(account, email.gmail_message_id)
    except Exception:
        logger.exception("Gmail permanent delete failed for %s", email.gmail_message_id)


# Grace period after a dashboard bin action before Gmail label sync may
# override local deleted/restored state (trash propagation can lag).
GMAIL_BIN_SYNC_GRACE_SECONDS = 120
_bin_sync_grace_until: dict[str, datetime] = {}


def note_bin_state_change(email_ids: Iterable[str]) -> None:
    """Pause bidirectional Gmail trash sync for these rows after a bin action."""
    deadline = datetime.now(timezone.utc) + timedelta(seconds=GMAIL_BIN_SYNC_GRACE_SECONDS)
    for email_id in email_ids:
        _bin_sync_grace_until[email_id] = deadline


def _in_bin_sync_grace(email_id: str, now: datetime) -> bool:
    deadline = _bin_sync_grace_until.get(email_id)
    if deadline is None:
        return False
    if now >= deadline:
        _bin_sync_grace_until.pop(email_id, None)
        return False
    return True


def _sync_states_from_gmail(db: Session, account: models.EmailAccount) -> None:
    """Reconcile dashboard read/archive/bin from stored Gmail label snapshots.

    Rows imported before label mirroring still fall back to live label fetches.
    """
    from app.pilot2 import gmail_labels

    now = datetime.now(timezone.utc)
    rows = (
        db.query(models.Email)
        .filter(models.Email.account_email == account.email,
                models.Email.gmail_message_id.isnot(None))
        .all()
    )

    needs_live = [r for r in rows if not r.gmail_label_ids]
    trash_ids = inbox_ids = unread_ids = None
    if needs_live and gmail.is_live():
        trash_ids = gmail.fetch_label_ids(account, "TRASH")
        unread_ids = gmail.fetch_label_ids(account, "UNREAD")
        inbox_ids = gmail.fetch_label_ids(account, "INBOX")

    for row in rows:
        if _in_bin_sync_grace(row.id, now):
            continue

        if row.gmail_label_ids:
            flags = gmail_labels.derive_label_flags(
                row.gmail_label_ids,
                account_email=account.email,
                from_email=row.from_email,
            )
            gmail_labels.apply_label_flags(row, flags, now=now)
            continue

        if trash_ids is None:
            continue
        if row.gmail_message_id in trash_ids and not row.deleted:
            row.deleted = True
            row.deleted_at = now
        elif row.deleted and row.gmail_message_id not in trash_ids:
            row.deleted = False
            row.deleted_at = None
        row.read = row.gmail_message_id not in unread_ids
        if not row.deleted:
            row.archived = row.gmail_message_id not in inbox_ids


def poll_all_accounts(db: Session) -> int:
    """History-sync every connected inbox, then run a small AI batch."""
    if not gmail.is_live():
        return 0

    from app.pilot2 import sync

    changes = 0
    accounts = (
        db.query(models.EmailAccount)
        .filter(
            models.EmailAccount.status == "Connected",
            models.EmailAccount.oauth_refresh_token.isnot(None),
        )
        .all()
    )
    for account in accounts:
        try:
            changes += sync.sync_account_history(db, account)
        except Exception as exc:
            logger.exception("History sync failed for %s", account.email)
            db.rollback()
            if gmail.is_auth_revoked_error(exc):
                try:
                    # Re-load after rollback so we mutate a bound instance.
                    account = db.query(models.EmailAccount).filter(
                        models.EmailAccount.id == account.id
                    ).first()
                    if account is not None:
                        gmail.mark_account_auth_revoked(db, account, exc)
                        log(
                            db,
                            "inbox_auth_revoked",
                            f"Inbox {account.email} needs reconnect (Gmail token revoked).",
                        )
                except Exception:
                    logger.exception("Failed to mark %s as Disconnected after auth error", account.email)
            continue
        try:
            _sync_states_from_gmail(db, account)
        except Exception as exc:
            logger.exception("State sync failed for %s", account.email)
            if gmail.is_auth_revoked_error(exc):
                db.rollback()
                try:
                    account = db.query(models.EmailAccount).filter(
                        models.EmailAccount.id == account.id
                    ).first()
                    if account is not None:
                        gmail.mark_account_auth_revoked(db, account, exc)
                except Exception:
                    logger.exception("Failed to mark %s as Disconnected after auth error", account.email)
                continue
        account.last_synced_at = datetime.now(timezone.utc)
    db.commit()

    try:
        changes += sync.process_ai_batch(db)
    except Exception:
        logger.exception("AI batch failed during poll")
        db.rollback()

    if changes:
        # Push the fresh state to any open dashboard immediately.
        from app.pilot2 import realtime

        realtime.workspace_changed("poll", changes)

    return changes
