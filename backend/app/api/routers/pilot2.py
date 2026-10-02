"""Pilot 2 · Inbound Email Management API."""

import base64
import binascii
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app import models
from app.api.auth import require_admin
from app.api.dependencies import get_db
from app.pilot2 import config, diffing, gmail, ignore_list, oauth_pages, pipeline, sync, template_suggestions, token_crypto
from app.pilot2 import schemas
from app.pilot2.ai.distiller import run_distillation

router = APIRouter(prefix="/api/pilot2", tags=["pilot2"])
logger = logging.getLogger(__name__)


# ── Connected inboxes ────────────────────────────────────────


@router.get("/inboxes", response_model=List[schemas.InboxOut])
def list_inboxes(
    partner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    _purge_never_connected_inboxes(db)
    query = db.query(models.EmailAccount)
    if partner_id:
        partner = db.query(models.Partner).filter(models.Partner.id == partner_id).first()
        if partner is None:
            raise HTTPException(status_code=404, detail="Partner not found")
        query = query.filter(models.EmailAccount.partner_id == partner_id)
    return query.order_by(models.EmailAccount.id).all()


def _purge_never_connected_inboxes(db: Session) -> None:
    """Drop seed placeholders and abandoned connect attempts that never completed OAuth."""
    placeholders = (
        db.query(models.EmailAccount)
        .filter(
            models.EmailAccount.connected_at.is_(None),
            models.EmailAccount.status != "Connected",
        )
        .all()
    )
    if not placeholders:
        return
    for account in placeholders:
        db.query(models.EmailTemplate).filter(
            models.EmailTemplate.account_email == account.email
        ).delete(synchronize_session=False)
        db.query(models.Email).filter(
            models.Email.account_email == account.email
        ).delete(synchronize_session=False)
        db.delete(account)
    db.commit()


def _connected_inbox_count(db: Session) -> int:
    return (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.status == "Connected")
        .count()
    )


def _assert_can_add_inbox(db: Session) -> None:
    if _connected_inbox_count(db) >= config.MAX_CONNECTED_INBOXES:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum of {config.MAX_CONNECTED_INBOXES} connected inboxes reached. Disconnect one before adding another.",
        )


@router.get("/overview", response_model=schemas.Pilot2OverviewOut)
def get_overview(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Lightweight home-dashboard payload — avoids loading the full email workspace."""
    connected_accounts = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.status == "Connected")
        .all()
    )
    inbox_titles = {acc.email: acc.title for acc in connected_accounts}
    connected_emails = set(inbox_titles.keys())

    if connected_emails:
        new_emails = ignore_list.count_inbox_tab_emails(db, account_emails=connected_emails)
    else:
        new_emails = 0

    flagged_rows = [
        row
        for row in ignore_list.list_flagged_workspace_emails(db)
        if row.account_email in connected_emails
    ]
    flagged_emails = len(flagged_rows)

    by_inbox: dict[str, list] = {}
    for row in flagged_rows:
        by_inbox.setdefault(row.account_email, []).append(row)

    flagged_alert_rows: list = []
    for account in sorted(connected_accounts, key=lambda acc: (acc.title or acc.email).lower()):
        inbox_rows = by_inbox.get(account.email, [])
        inbox_rows.sort(
            key=lambda row: row.received_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        flagged_alert_rows.extend(inbox_rows[:2])
    if connected_emails:
        templates_active = (
            db.query(models.EmailTemplate)
            .filter(
                models.EmailTemplate.status == "Active",
                models.EmailTemplate.account_email.in_(connected_emails),
            )
            .count()
        )
    else:
        templates_active = 0

    templates_by_inbox: dict[str, list] = {}
    if connected_emails:
        for tmpl in (
            db.query(models.EmailTemplate)
            .filter(
                models.EmailTemplate.account_email.in_(connected_emails),
                models.EmailTemplate.status.in_(["Active", "Draft"]),
            )
            .all()
        ):
            templates_by_inbox.setdefault(tmpl.account_email, []).append(tmpl)

    activity_rows: list = []
    for account in sorted(connected_accounts, key=lambda acc: (acc.title or acc.email).lower()):
        inbox_rows = templates_by_inbox.get(account.email, [])
        inbox_rows.sort(
            key=lambda row: row.created_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        for tmpl in inbox_rows[:2]:
            activity_rows.append(
                {
                    "id": tmpl.id,
                    "timestamp": tmpl.created_at,
                    "type": "template_created",
                    "description": tmpl.name,
                    "emailId": tmpl.id,
                    "inboxTitle": inbox_titles.get(account.email, account.email),
                }
            )
    flagged_alerts = [
        {
            "id": row.id,
            "title": row.subject or "Flagged email requires review",
            "subtitle": row.flag_reason or "Requires manual review",
            "inboxTitle": inbox_titles.get(row.account_email, row.account_email),
            "timestamp": row.received_at.isoformat() if row.received_at else None,
        }
        for row in flagged_alert_rows
    ]
    return {
        "newEmails": new_emails,
        "flaggedEmails": flagged_emails,
        "templatesActive": templates_active,
        "activity": activity_rows,
        "flaggedAlerts": flagged_alerts,
    }


@router.get("/intents", response_model=List[str])
def list_intents(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """All intents the system knows — the seed set plus any the AI auto-created
    from emails. Backs the intent filter and template intent selector."""
    return pipeline.known_intent_names(db)


@router.get("/workspace", response_model=schemas.Pilot2WorkspaceOut)
def get_workspace(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    inboxes = db.query(models.EmailAccount).order_by(models.EmailAccount.id).all()
    # Emails awaiting AI (Imported/Processing) are withheld: the queue must
    # only ever grow. An email appears once, fully classified, instead of
    # showing up and then vanishing when the classifier marks it Ignored.
    emails = (
        db.query(models.Email)
        .filter(models.Email.draft_status.notin_(["Ignored", "Imported", "Processing"]))
        .order_by(models.Email.received_at.desc())
        .all()
    )
    rules_by_inbox = ignore_list.load_rules_grouped(db)
    emails = ignore_list.filter_emails_by_ignore_list(emails, rules_by_inbox)
    pending_ai = (
        db.query(models.Email)
        .filter(models.Email.draft_status.in_(["Imported", "Processing"]))
        .count()
    )
    return {"emails": emails, "inboxes": inboxes, "pendingAiCount": pending_ai}


@router.post("/inboxes/connect")
def connect_inbox(payload: schemas.InboxConnectIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    title = payload.title.strip()
    email = (payload.email or "").strip().lower()
    partner_id = (payload.partnerId or "").strip() or None
    if not title:
        raise HTTPException(status_code=400, detail="Display name cannot be empty.")
    if email and "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid Gmail address.")
    if partner_id:
        partner = db.query(models.Partner).filter(models.Partner.id == partner_id).first()
        if partner is None:
            raise HTTPException(status_code=404, detail="Partner not found")

    account = None
    if email:
        account = (
            db.query(models.EmailAccount)
            .filter(models.EmailAccount.email == email)
            .first()
        )
    if account is None:
        _assert_can_add_inbox(db)
        account_id = pipeline.next_id(db, models.EmailAccount, "inbox")
        account = models.EmailAccount(
            id=account_id,
            email=email or f"__pending__{account_id}@connect.local",
            title=title,
            partner_id=partner_id,
        )
        db.add(account)
    else:
        if partner_id and account.partner_id and account.partner_id != partner_id:
            raise HTTPException(status_code=409, detail="Inbox already belongs to a different partner.")
        if partner_id and not account.partner_id:
            account.partner_id = partner_id
        account.title = title

    if gmail.is_live():
        # OAuth state is the inbox id so Google supplies the email on callback.
        db.commit()
        return {"authUrl": gmail.get_authorization_url(state=account.id)}

    if not email:
        raise HTTPException(
            status_code=400,
            detail="Gmail address is required when Gmail is in mock mode.",
        )
    account.status = "Connected"
    account.connected_at = datetime.now(timezone.utc)
    pipeline.log(db, "inbox_connected", f"Inbox {account.email} connected (mock mode).")
    db.commit()
    return {"status": "Connected", "email": account.email}


@router.get("/inboxes/oauth/callback", response_class=HTMLResponse)
def oauth_callback(code: str, state: str, db: Session = Depends(get_db)):
    try:
        authorized_email, refresh_token = gmail.exchange_code(code, state)
    except Exception as exc:
        return HTMLResponse(
            oauth_pages.oauth_error_page(message=str(exc)),
            status_code=400,
        )

    account = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.id == state)
        .first()
    )
    if account is None:
        account = (
            db.query(models.EmailAccount)
            .filter(models.EmailAccount.email == state)
            .first()
        )
    if account is None:
        return HTMLResponse(
            oauth_pages.oauth_error_page(
                message="This connection session expired. Go back to Email accounts and try again."
            ),
            status_code=400,
        )

    duplicate = (
        db.query(models.EmailAccount)
        .filter(
            models.EmailAccount.email == authorized_email,
            models.EmailAccount.id != account.id,
        )
        .first()
    )
    if duplicate is not None:
        return HTMLResponse(
            oauth_pages.oauth_error_page(
                message=f"{authorized_email} is already connected as {duplicate.title}."
            ),
            status_code=400,
        )

    account.email = authorized_email
    if account.status != "Connected" and _connected_inbox_count(db) >= config.MAX_CONNECTED_INBOXES:
        return HTMLResponse(
            oauth_pages.oauth_error_page(
                message=(
                    f"Maximum of {config.MAX_CONNECTED_INBOXES} connected inboxes reached. "
                    "Disconnect one in Email accounts, then try again."
                )
            ),
            status_code=400,
        )
    if refresh_token:
        account.oauth_refresh_token = token_crypto.encrypt_token(refresh_token)
    elif not account.oauth_refresh_token:
        return HTMLResponse(
            oauth_pages.oauth_error_page(
                message=(
                    "Google did not return a refresh token. Remove this app from your "
                    "Google Account → Security → Third-party access, then connect again."
                )
            ),
            status_code=400,
        )
    account.status = "Connected"
    account.connected_at = datetime.now(timezone.utc)
    account.backfill_error = None
    try:
        profile = gmail.get_profile(account)
        account.gmail_history_id = str(profile.get("historyId", "")) or None
    except Exception:
        pass
    pipeline.log(db, "inbox_connected", f"Inbox {account.email} connected via Google OAuth.")
    db.commit()

    # Arm Gmail push first so new mail is delivered in ~1s from now on (no-op
    # unless a Pub/Sub topic is configured). Best-effort: connection must
    # succeed regardless.
    try:
        sync.arm_watch(db, account)
    except Exception:
        logger.exception("Arming Gmail push failed for %s", account.email)

    # Backfill recent history. On serverless there is no reliable background
    # thread (Vercel freezes the function once the response is sent), so import
    # synchronously within a time budget — it always completes and marks itself
    # "done" inside the request. Push already covers every new message from now
    # on (gmail_history_id is captured at the start of the backfill), so a
    # time-boxed partial import only ever drops some older history, never new
    # mail. Locally, keep the background thread so the success page is instant.
    if config.SERVERLESS:
        import time as _time

        try:
            sync.run_backfill(
                db,
                account,
                deadline=_time.monotonic() + config.BACKFILL_TIME_BUDGET_SECONDS,
            )
        except Exception:
            logger.exception("Backfill failed for %s", account.email)
    else:
        sync.start_backfill(account.id)

    return HTMLResponse(
        oauth_pages.oauth_success_page(email=account.email, title=account.title)
    )


@router.get("/inboxes/{inbox_id}/sync-status", response_model=schemas.InboxSyncStatusOut)
def inbox_sync_status(inbox_id: str, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    account = db.query(models.EmailAccount).filter(models.EmailAccount.id == inbox_id).first()
    if account is None:
        raise HTTPException(status_code=404, detail="Inbox not found")
    return account


@router.post("/inboxes/{inbox_id}/disconnect", response_model=schemas.InboxOut)
def disconnect_inbox(inbox_id: str, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    account = db.query(models.EmailAccount).filter(models.EmailAccount.id == inbox_id).first()
    if account is None:
        raise HTTPException(status_code=404, detail="Inbox not found")
    # Stop Gmail push before we drop the token (best-effort).
    try:
        gmail.stop_watch(account)
    except Exception:
        logger.exception("Stopping Gmail push failed for %s", account.email)
    account.status = "Disconnected"
    account.oauth_refresh_token = None
    account.watch_expiration = None
    pipeline.log(db, "inbox_disconnected", f"Inbox {account.email} disconnected.")
    db.commit()
    db.refresh(account)
    return account


@router.post("/inboxes/{inbox_id}/watch", response_model=schemas.InboxOut)
def arm_inbox_watch(inbox_id: str, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Manually (re-)arm Gmail push for one inbox — ops/debugging helper."""
    account = db.query(models.EmailAccount).filter(models.EmailAccount.id == inbox_id).first()
    if account is None:
        raise HTTPException(status_code=404, detail="Inbox not found")
    if account.status != "Connected":
        raise HTTPException(status_code=400, detail="Inbox is not connected.")
    if not config.gmail_push_enabled():
        raise HTTPException(
            status_code=400,
            detail="Gmail push is not configured (set PILOT2_GMAIL_MODE=live and PILOT2_GMAIL_PUBSUB_TOPIC).",
        )
    sync.arm_watch(db, account)
    db.refresh(account)
    return account


@router.patch("/inboxes/{inbox_id}", response_model=schemas.InboxOut)
def update_inbox(inbox_id: str, payload: schemas.InboxUpdateIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    account = db.query(models.EmailAccount).filter(models.EmailAccount.id == inbox_id).first()
    if account is None:
        raise HTTPException(status_code=404, detail="Inbox not found")
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    account.title = title
    pipeline.log(db, "inbox_renamed", f"Inbox {account.email} renamed to '{title}'.")
    db.commit()
    db.refresh(account)
    return account


@router.delete("/inboxes/{inbox_id}")
def delete_inbox(inbox_id: str, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    account = db.query(models.EmailAccount).filter(models.EmailAccount.id == inbox_id).first()
    if account is None:
        raise HTTPException(status_code=404, detail="Inbox not found")
    email = account.email
    if account.status == "Connected":
        try:
            gmail.stop_watch(account)
        except Exception:
            logger.exception("Stopping Gmail push failed for %s", account.email)
        account.status = "Disconnected"
        account.oauth_refresh_token = None
        account.watch_expiration = None
    db.query(models.EmailTemplate).filter(
        models.EmailTemplate.account_email == email
    ).delete(synchronize_session=False)
    # Remove the inbox's imported emails too, otherwise they linger as
    # orphans in the workspace payload after the inbox is gone.
    db.query(models.Email).filter(
        models.Email.account_email == email
    ).delete(synchronize_session=False)
    db.delete(account)
    pipeline.log(db, "inbox_deleted", f"Inbox {email} removed.")
    db.commit()
    return {"deleted": inbox_id}


# ── Ignore list ──────────────────────────────────────────────


@router.get("/ignore-list", response_model=List[schemas.IgnoreRuleOut])
def list_ignore_rules(
    inbox: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    query = db.query(models.EmailIgnoreRule).order_by(models.EmailIgnoreRule.created_at.desc())
    if inbox:
        query = query.filter(models.EmailIgnoreRule.account_email == inbox)
    return query.all()


@router.post("/ignore-list", response_model=schemas.IgnoreRuleOut)
def create_ignore_rule(
    payload: schemas.IgnoreRuleCreateIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    account = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.email == payload.inbox)
        .first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Inbox not found")

    try:
        kind, pattern = ignore_list.parse_ignore_pattern(payload.pattern)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing = (
        db.query(models.EmailIgnoreRule)
        .filter(
            models.EmailIgnoreRule.account_email == payload.inbox,
            models.EmailIgnoreRule.kind == kind,
            models.EmailIgnoreRule.pattern == pattern,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="That sender is already on the ignore list.")

    rule = models.EmailIgnoreRule(
        id=pipeline.next_id(db, models.EmailIgnoreRule, "ignore"),
        account_email=payload.inbox,
        kind=kind,
        pattern=pattern,
        created_at=datetime.now(timezone.utc),
    )
    db.add(rule)
    pipeline.log(db, "ignore_rule_added", f"Ignored {kind} {pattern} for {payload.inbox}.")
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/ignore-list/{rule_id}")
def delete_ignore_rule(
    rule_id: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    rule = db.query(models.EmailIgnoreRule).filter(models.EmailIgnoreRule.id == rule_id).first()
    if rule is None:
        raise HTTPException(status_code=404, detail="Ignore rule not found")
    db.delete(rule)
    pipeline.log(db, "ignore_rule_removed", f"Removed ignore rule {rule_id}.")
    db.commit()
    return {"deleted": rule_id}


# ── Emails ───────────────────────────────────────────────────


@router.get("/emails", response_model=List[schemas.EmailOut])
def list_emails(inbox: Optional[str] = None, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    query = db.query(models.Email).filter(models.Email.draft_status != "Ignored")
    if inbox:
        query = query.filter(models.Email.account_email == inbox)
    emails = query.order_by(models.Email.received_at.desc()).all()
    rules_by_inbox = ignore_list.load_rules_grouped(db)
    return ignore_list.filter_emails_by_ignore_list(emails, rules_by_inbox)


@router.get("/emails/{email_id}", response_model=schemas.EmailOut)
def get_email(email_id: str, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    email = db.query(models.Email).filter(models.Email.id == email_id).first()
    if email is None:
        raise HTTPException(status_code=404, detail="Email not found")
    rules = ignore_list.load_rules_for_inbox(db, email.account_email)
    if ignore_list.is_email_ignored(email, rules):
        raise HTTPException(status_code=404, detail="Email not found")
    return email


def _decode_attachment_bytes(data: str) -> bytes:
    """Decode base64 that may be either URL-safe (Gmail) or standard (ingest)."""
    import base64

    padded = data + "=" * (-len(data) % 4)
    try:
        return base64.urlsafe_b64decode(padded)
    except Exception:
        return base64.b64decode(padded)


@router.get("/emails/{email_id}/attachments/{attachment_id}")
def download_attachment(
    email_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """Stream one attachment's bytes.

    Bytes come from the stored inline payload when present (mock / small
    inline parts), otherwise they're fetched from Gmail on demand (live).
    """
    from fastapi.responses import Response

    attachment = (
        db.query(models.EmailAttachment)
        .filter(
            models.EmailAttachment.id == attachment_id,
            models.EmailAttachment.email_id == email_id,
        )
        .first()
    )
    if attachment is None:
        raise HTTPException(status_code=404, detail="Attachment not found")

    content: Optional[bytes] = None
    if attachment.content_base64:
        content = _decode_attachment_bytes(attachment.content_base64)
    elif attachment.gmail_attachment_id:
        email = db.query(models.Email).filter(models.Email.id == email_id).first()
        account = (
            db.query(models.EmailAccount)
            .filter(models.EmailAccount.email == email.account_email)
            .first()
            if email
            else None
        )
        if account is None or not email or not email.gmail_message_id:
            raise HTTPException(status_code=404, detail="Attachment source unavailable.")
        try:
            content = gmail.fetch_attachment(
                account, email.gmail_message_id, attachment.gmail_attachment_id
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Could not fetch attachment: {exc}")

    if content is None:
        raise HTTPException(status_code=404, detail="Attachment has no downloadable content.")

    safe_name = (attachment.filename or "attachment").replace('"', "")
    return Response(
        content=content,
        media_type=attachment.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.post("/emails/ingest", response_model=schemas.EmailOut)
def ingest_email(payload: schemas.EmailIngestIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Feed one inbound email through the pipeline. Used for dev/testing in
    mock mode; in live mode the Gmail poller calls the same pipeline."""
    account = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.email == payload.inbox)
        .first()
    )
    if account is None or account.status != "Connected":
        raise HTTPException(status_code=400, detail=f"Inbox {payload.inbox} is not connected.")
    return pipeline.process_incoming(
        db,
        account_email=payload.inbox,
        from_name=payload.fromName,
        from_email=payload.fromEmail,
        subject=payload.subject,
        body=payload.body,
        received_at=payload.receivedAt,
        gmail_message_id=payload.gmailMessageId,
        gmail_thread_id=payload.gmailThreadId,
        to_emails=payload.toEmails,
        cc_emails=payload.ccEmails,
        html_body=payload.htmlBody,
        snippet=payload.snippet,
        message_id_header=payload.messageIdHeader,
        in_reply_to_header=payload.inReplyToHeader,
        references_header=payload.referencesHeader,
        is_forward=payload.isForward,
        forwarded_by_name=payload.forwardedByName,
        forwarded_by_email=payload.forwardedByEmail,
        original_from_name=payload.originalFromName,
        original_from_email=payload.originalFromEmail,
        attachments=[a.model_dump() for a in payload.attachments] if payload.attachments else None,
    )


def _apply_email_patch(email: models.Email, payload: schemas.EmailPatchIn) -> None:
    if payload.read is not None:
        email.read = payload.read
    if payload.archived is not None:
        email.archived = payload.archived
    if payload.deleted is not None:
        email.deleted = payload.deleted
        email.deleted_at = datetime.now(timezone.utc) if payload.deleted else None
    if payload.flagged is not None:
        email.flagged = payload.flagged
        if email.draft_status != "Sent":
            if payload.flagged:
                email.flag_reason = payload.flagReason or "Manual review requested"
                email.draft_status = "Flagged"
            else:
                email.flag_reason = None
                email.draft_status = "Draft Created"


@router.patch("/emails/{email_id}", response_model=schemas.EmailOut)
def patch_email(email_id: str, payload: schemas.EmailPatchIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    email = db.query(models.Email).filter(models.Email.id == email_id).first()
    if email is None:
        raise HTTPException(status_code=404, detail="Email not found")
    if payload.deleted is not None:
        pipeline.note_bin_state_change([email_id])
    _apply_email_patch(email, payload)
    # Mirror the change onto the real Gmail message (best-effort).
    pipeline.sync_flags_to_gmail(
        db, [email],
        read=payload.read, archived=payload.archived, deleted=payload.deleted,
    )
    db.commit()
    db.refresh(email)
    return email


@router.post("/emails/bulk-patch", response_model=List[schemas.EmailOut])
def bulk_patch_emails(payload: schemas.EmailBulkPatchIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    if payload.deleted is not None:
        pipeline.note_bin_state_change(payload.ids)
    emails = db.query(models.Email).filter(models.Email.id.in_(payload.ids)).all()
    for email in emails:
        _apply_email_patch(email, payload)
    pipeline.sync_flags_to_gmail(
        db, emails,
        read=payload.read, archived=payload.archived, deleted=payload.deleted,
    )
    db.commit()
    for email in emails:
        db.refresh(email)
    return emails


@router.delete("/emails/{email_id}")
def delete_email_forever(email_id: str, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Hard delete one email here AND in Gmail. Only allowed from the bin."""
    email = db.query(models.Email).filter(models.Email.id == email_id).first()
    if email is None:
        raise HTTPException(status_code=404, detail="Email not found")
    if not email.deleted:
        raise HTTPException(status_code=400, detail="Move the email to the bin first.")
    pipeline.delete_forever_in_gmail(db, email)
    db.delete(email)
    pipeline.log(db, "email_deleted", f"Email deleted forever: '{email.subject}'", email_id)
    db.commit()
    return {"deleted": email_id}


@router.post("/emails/bin/empty")
def empty_bin(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Hard delete everything currently in the bin, here and in Gmail."""
    binned = db.query(models.Email).filter(models.Email.deleted.is_(True)).all()
    count = len(binned)
    for email in binned:
        pipeline.delete_forever_in_gmail(db, email)
        db.delete(email)
    if count:
        pipeline.log(db, "bin_emptied", f"Bin emptied. {count} emails deleted forever.")
    db.commit()
    return {"deleted": count}


@router.put("/emails/{email_id}/draft", response_model=schemas.EmailOut)
def update_draft(email_id: str, payload: schemas.DraftUpdateIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    email = db.query(models.Email).filter(models.Email.id == email_id).first()
    if email is None:
        raise HTTPException(status_code=404, detail="Email not found")
    if email.draft_status == "Sent":
        raise HTTPException(status_code=400, detail="Reply already sent.")
    email.draft_body = payload.draftBody
    if email.draft_status == "Draft Created":
        email.draft_status = "Reviewed"
    db.commit()
    db.refresh(email)
    return email


@router.post("/emails/{email_id}/send", response_model=schemas.EmailOut)
def send_email(email_id: str, payload: schemas.SendIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    email = db.query(models.Email).filter(models.Email.id == email_id).first()
    if email is None:
        raise HTTPException(status_code=404, detail="Email not found")
    if email.draft_status == "Sent":
        raise HTTPException(status_code=400, detail="Reply already sent.")

    account = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.email == email.account_email)
        .first()
    )
    if account is None or account.status != "Connected":
        raise HTTPException(status_code=400, detail="Inbox is not connected.")

    final_body = payload.finalBody
    result = gmail.send_reply(account, email, final_body)

    # Learning signal: deterministic diff between what the AI drafted and what
    # the admin actually sent. Raw rows accumulate here; the nightly distiller
    # compresses them into the capped guidance notes.
    ai_draft = email.draft_body or ""
    db.add(models.DraftEdit(
        email_id=email.id,
        intent=email.intent,
        template_id=email.template_ids[0] if email.template_ids else None,
        language=email.language,
        draft_body=ai_draft,
        final_body=final_body,
        diff=diffing.unified_diff(ai_draft, final_body),
        edit_ratio=diffing.edit_ratio(ai_draft, final_body),
        created_at=datetime.now(timezone.utc),
    ))
    template_suggestions.maybe_suggest_new_template(db, email, final_body)

    email.sent_at = datetime.now(timezone.utc)
    email.sent_body = final_body
    email.sent_gmail_message_id = result.gmail_message_id
    email.sent_message_id_header = result.message_id_header
    # Extend the thread's RFC References chain now that we've added a link, so
    # any *future* reply/forward on this thread (Phase 3) chains from Andrea's
    # send instead of the customer's last message.
    email.references_header = result.references_header
    email.draft_status = "Sent"
    email.flagged = False
    email.flag_reason = None
    email.read = True

    pipeline.log(db, "reply_sent", f"Reply sent to {email.from_email}.", email.id)
    db.commit()
    db.refresh(email)
    return email


def _load_sendable_email(db: Session, email_id: str) -> tuple[models.Email, models.EmailAccount]:
    """Shared preflight for the reply / reply-all / forward endpoints."""
    email = db.query(models.Email).filter(models.Email.id == email_id).first()
    if email is None:
        raise HTTPException(status_code=404, detail="Email not found")
    account = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.email == email.account_email)
        .first()
    )
    if account is None or account.status != "Connected":
        raise HTTPException(status_code=400, detail="Inbox is not connected.")
    return email, account


@router.post("/emails/{email_id}/reply-all", response_model=schemas.EmailOut)
def reply_all_email(
    email_id: str,
    payload: schemas.ReplyAllIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    email, account = _load_sendable_email(db, email_id)
    if email.draft_status == "Sent":
        raise HTTPException(status_code=400, detail="Reply already sent.")

    final_body = payload.finalBody
    result = gmail.send_reply_all(
        account,
        email,
        final_body,
        to_emails=payload.toEmails,
        cc_emails=payload.ccEmails,
    )

    # Same learning signal we record for a plain reply — the diff between the
    # AI draft and Andrea's final body is the training feedback, and it is
    # meaningful regardless of whether the send was reply or reply-all.
    ai_draft = email.draft_body or ""
    db.add(models.DraftEdit(
        email_id=email.id,
        intent=email.intent,
        template_id=email.template_ids[0] if email.template_ids else None,
        language=email.language,
        draft_body=ai_draft,
        final_body=final_body,
        diff=diffing.unified_diff(ai_draft, final_body),
        edit_ratio=diffing.edit_ratio(ai_draft, final_body),
        created_at=datetime.now(timezone.utc),
    ))
    template_suggestions.maybe_suggest_new_template(db, email, final_body)

    email.sent_at = datetime.now(timezone.utc)
    email.sent_body = final_body
    email.sent_gmail_message_id = result.gmail_message_id
    email.sent_message_id_header = result.message_id_header
    email.references_header = result.references_header
    email.draft_status = "Sent"
    email.flagged = False
    email.flag_reason = None
    email.read = True

    cc_summary = ", ".join(payload.ccEmails) if payload.ccEmails else "no Cc"
    to_summary = ", ".join(payload.toEmails) if payload.toEmails else email.from_email
    pipeline.log(
        db,
        "reply_sent",
        f"Reply-all sent to {to_summary} ({cc_summary}).",
        email.id,
    )
    db.commit()
    db.refresh(email)
    return email


@router.post("/emails/{email_id}/forward", response_model=schemas.EmailOut)
def forward_email(
    email_id: str,
    payload: schemas.ForwardIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """Forward the message to a new set of recipients on the SAME Gmail thread.

    A forward is *not* the same as a reply — the original inbound still lives
    on the thread and may still get replied to. We record the outbound Gmail
    identifiers on the source row (so history sync dedupes Andrea's own echo)
    but leave `draft_status` alone unless the row had been sitting on the
    inbox awaiting a reply, in which case forwarding it *is* Andrea acting on
    it, so we mark it Reviewed instead of Sent.
    """
    email, account = _load_sendable_email(db, email_id)

    self_email = (account.email or "").lower()
    for addr in payload.toEmails + payload.ccEmails:
        if addr.lower() == self_email:
            raise HTTPException(
                status_code=400,
                detail="Cannot forward to the same inbox that owns the message.",
            )

    final_body = payload.finalBody
    result = gmail.send_forward(
        account,
        email,
        final_body,
        to_emails=payload.toEmails,
        cc_emails=payload.ccEmails,
    )

    email.sent_at = datetime.now(timezone.utc)
    email.sent_body = final_body
    email.sent_gmail_message_id = result.gmail_message_id
    email.sent_message_id_header = result.message_id_header
    email.references_header = result.references_header
    if email.draft_status not in {"Sent"}:
        # Forwarding *is* Andrea handling the message, so it leaves the
        # pending queue. But we don't call it "Sent" because a real reply may
        # still be needed — "Reviewed" is our existing state for that.
        email.draft_status = "Reviewed"
    email.read = True

    recipients = ", ".join(payload.toEmails)
    pipeline.log(db, "reply_sent", f"Forwarded to {recipients}.", email.id)
    db.commit()
    db.refresh(email)
    return email


@router.post("/compose", response_model=schemas.EmailOut)
def compose_email(
    payload: schemas.ComposeIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """Send a brand-new message Andrea wrote herself (Gmail-style Compose).

    No AI is involved and there is no parent message — this starts a fresh
    thread. The sent message is persisted as an outbound Email row so it
    appears in the Sent mailbox and history sync can dedupe Gmail's echo.
    """
    account = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.email == payload.inbox)
        .first()
    )
    if account is None or account.status != "Connected":
        raise HTTPException(status_code=400, detail=f"Inbox {payload.inbox} is not connected.")

    self_email = (account.email or "").lower()
    if any(addr.lower() == self_email for addr in payload.toEmails + payload.ccEmails + payload.bccEmails):
        raise HTTPException(
            status_code=400,
            detail="Cannot send a new message to the sending inbox itself.",
        )

    result = gmail.send_new_message(
        account,
        to_emails=payload.toEmails,
        cc_emails=payload.ccEmails,
        bcc_emails=payload.bccEmails,
        subject=payload.subject,
        body=payload.finalBody,
    )

    now = datetime.now(timezone.utc)
    email = models.Email(
        id=pipeline.next_id(db, models.Email, "email"),
        account_email=account.email,
        gmail_message_id=result.gmail_message_id,
        gmail_thread_id=result.gmail_thread_id,
        gmail_is_outbound=True,
        from_name=account.title or account.email,
        from_email=account.email,
        to_emails=list(payload.toEmails),
        cc_emails=list(payload.ccEmails),
        subject=payload.subject or "(no subject)",
        body=payload.finalBody,
        received_at=now,
        message_id_header=result.message_id_header,
        references_header=result.references_header,
        draft_status="Sent",
        read=True,
        sent_at=now,
        sent_body=payload.finalBody,
        sent_gmail_message_id=result.gmail_message_id,
        sent_message_id_header=result.message_id_header,
    )
    db.add(email)
    pipeline.log(
        db,
        "reply_sent",
        f"New message sent to {', '.join(payload.toEmails)}.",
        email.id,
    )
    db.commit()
    db.refresh(email)
    return email


# ── Templates ────────────────────────────────────────────────


@router.get("/templates", response_model=List[schemas.TemplateOut])
def list_templates(inbox: Optional[str] = None, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    query = db.query(models.EmailTemplate)
    if inbox:
        query = query.filter(models.EmailTemplate.account_email == inbox)
    return query.order_by(models.EmailTemplate.name).all()


def _embed_template_best_effort(db: Session, template: models.EmailTemplate) -> None:
    """Compute + store the template's semantic embedding. Best-effort: a model
    outage or rate limit must never fail the template save."""
    try:
        from app.pilot2.ai import embeddings

        if embeddings.embed_and_store_template(db, template):
            db.commit()
    except Exception:
        logger.exception("Template embedding failed for %s", template.id)
        db.rollback()


@router.post("/templates", response_model=schemas.TemplateOut)
def create_template(payload: schemas.TemplateIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    account = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.email == payload.inbox)
        .first()
    )
    if account is None:
        raise HTTPException(status_code=400, detail=f"Inbox {payload.inbox} not found")
    now = datetime.now(timezone.utc)
    template = models.EmailTemplate(
        id=pipeline.next_id(db, models.EmailTemplate, "tmpl"),
        account_email=payload.inbox,
        name=payload.name,
        category=payload.category,
        intent=payload.intent,
        status=payload.status,
        subject=payload.subject,
        body=payload.body,
        times_used=0,
        created_at=now,
        last_updated=now,
    )
    db.add(template)
    pipeline.log(db, "template_created", f"Template created: {template.name}", email_id=template.id)
    db.commit()
    db.refresh(template)
    _embed_template_best_effort(db, template)
    return template


@router.put("/templates/{template_id}", response_model=schemas.TemplateOut)
def update_template(template_id: str, payload: schemas.TemplateUpdateIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    template = (
        db.query(models.EmailTemplate)
        .filter(models.EmailTemplate.id == template_id)
        .first()
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    template.name = payload.name
    template.category = payload.category
    template.intent = payload.intent
    template.status = payload.status
    template.subject = payload.subject
    template.body = payload.body
    template.last_updated = datetime.now(timezone.utc)
    pipeline.log(db, "template_updated", f"Template updated: {template.name}", email_id=template.id)
    db.commit()
    db.refresh(template)
    _embed_template_best_effort(db, template)
    return template


@router.delete("/templates/{template_id}", response_model=schemas.TemplateOut)
def delete_template(template_id: str, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Soft-delete: move template to Deleted (Archived)."""
    template = (
        db.query(models.EmailTemplate)
        .filter(models.EmailTemplate.id == template_id)
        .first()
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    if template.status != "Archived":
        template.archived_from = template.status
    template.status = "Archived"
    template.last_updated = datetime.now(timezone.utc)
    pipeline.log(db, "template_archived", f"Template moved to deleted: {template.name}")
    db.commit()
    db.refresh(template)
    return template


@router.post("/templates/{template_id}/restore", response_model=schemas.TemplateOut)
def restore_template(template_id: str, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    template = (
        db.query(models.EmailTemplate)
        .filter(models.EmailTemplate.id == template_id)
        .first()
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    template.status = template.archived_from or "Active"
    template.archived_from = None
    template.last_updated = datetime.now(timezone.utc)
    pipeline.log(db, "template_restored", f"Template restored: {template.name}")
    db.commit()
    db.refresh(template)
    return template


@router.delete("/templates/{template_id}/forever")
def delete_template_forever(template_id: str, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    template = (
        db.query(models.EmailTemplate)
        .filter(models.EmailTemplate.id == template_id)
        .first()
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    name = template.name
    db.delete(template)
    pipeline.log(db, "template_deleted", f"Template deleted forever: {name}")
    db.commit()
    return {"deleted": template_id}


# ── Learning loop ────────────────────────────────────────────


@router.get("/guidance", response_model=List[schemas.GuidanceNoteOut])
def list_guidance(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    return db.query(models.GuidanceNote).order_by(models.GuidanceNote.intent).all()


@router.get("/suggestions", response_model=List[schemas.TemplateSuggestionOut])
def list_suggestions(
    status: str = "pending",
    inbox: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    query = (
        db.query(models.TemplateSuggestion)
        .filter(models.TemplateSuggestion.status == status)
        .order_by(models.TemplateSuggestion.created_at.desc())
    )
    if inbox:
        query = query.filter(models.TemplateSuggestion.account_email == inbox)
    return query.all()


@router.post("/suggestions/{suggestion_id}/approve", response_model=schemas.TemplateOut)
def approve_suggestion(suggestion_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    suggestion = (
        db.query(models.TemplateSuggestion)
        .filter(models.TemplateSuggestion.id == suggestion_id)
        .first()
    )
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if suggestion.status != "pending":
        raise HTTPException(status_code=400, detail="Suggestion already resolved.")

    now = datetime.now(timezone.utc)
    if suggestion.kind == "revision" and suggestion.template_id:
        template = (
            db.query(models.EmailTemplate)
            .filter(models.EmailTemplate.id == suggestion.template_id)
            .first()
        )
        if template is None:
            raise HTTPException(status_code=404, detail="Target template not found")
        template.subject = suggestion.suggested_subject
        template.body = suggestion.suggested_body
        template.last_updated = now
    else:
        inbox_email = suggestion.account_email
        if not inbox_email and suggestion.source_email_id:
            source = (
                db.query(models.Email)
                .filter(models.Email.id == suggestion.source_email_id)
                .first()
            )
            inbox_email = source.account_email if source else None
        account = None
        if inbox_email:
            account = (
                db.query(models.EmailAccount)
                .filter(models.EmailAccount.email == inbox_email)
                .first()
            )
        if account is None:
            account = db.query(models.EmailAccount).order_by(models.EmailAccount.id).first()
        if account is None:
            raise HTTPException(status_code=400, detail="No inbox configured for new template")
        category = "General Enquiries"
        if suggestion.intent == "Membership":
            category = "Membership"
        elif suggestion.intent == "Payments":
            category = "Payments"
        elif suggestion.intent == "Events":
            category = "Events"
        template = models.EmailTemplate(
            id=pipeline.next_id(db, models.EmailTemplate, "tmpl"),
            account_email=account.email,
            name=suggestion.suggested_name,
            category=category,
            intent=suggestion.intent,
            status="Active",
            subject=suggestion.suggested_subject,
            body=suggestion.suggested_body,
            times_used=0,
            created_at=now,
            last_updated=now,
        )
        db.add(template)

    suggestion.status = "approved"
    suggestion.resolved_at = now
    pipeline.log(
        db, "suggestion_approved",
        f"Template suggestion approved: {suggestion.suggested_name}",
    )
    db.commit()
    db.refresh(template)
    return template


@router.post("/suggestions/{suggestion_id}/reject", response_model=schemas.TemplateSuggestionOut)
def reject_suggestion(suggestion_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    suggestion = (
        db.query(models.TemplateSuggestion)
        .filter(models.TemplateSuggestion.id == suggestion_id)
        .first()
    )
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    suggestion.status = "rejected"
    suggestion.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(suggestion)
    return suggestion


from app.api.cron_auth import require_cron_secret
@router.api_route("/poll", methods=["GET", "POST"])
def trigger_poll(request: Request, secret: Optional[str] = None, db: Session = Depends(get_db)):
    """Manually fetch new Gmail messages (also runs on a schedule in live
    mode; an external cron service hits this endpoint on serverless hosting)."""
    require_cron_secret(request, secret)
    connected = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.status == "Connected")
        .order_by(models.EmailAccount.email)
        .all()
    )
    processed = pipeline.poll_all_accounts(db)
    refreshed = (
        db.query(models.EmailAccount)
        .filter(models.EmailAccount.status == "Connected")
        .order_by(models.EmailAccount.email)
        .all()
    )
    needs_reconnect = [
        account.email
        for account in refreshed
        if not account.oauth_refresh_token or account.backfill_error == "oauth_revoked"
    ]
    syncable = [account for account in refreshed if account.oauth_refresh_token]
    result = {
        "emailsProcessed": processed,
        "gmailMode": config.GMAIL_MODE,
        "connectedInboxes": len(refreshed),
        "inboxes": [
            {
                "email": account.email,
                "status": account.status,
                "needsReconnect": account.email in set(needs_reconnect),
                "lastSyncedAt": account.last_synced_at.isoformat() if account.last_synced_at else None,
                "backfillStatus": account.backfill_status,
                "hasRefreshToken": bool(account.oauth_refresh_token),
            }
            for account in refreshed
        ],
    }
    if needs_reconnect:
        result["needsReconnect"] = needs_reconnect
        result["warning"] = (
            "Gmail access expired for: "
            + ", ".join(needs_reconnect)
            + ". Reconnect the inbox in Partner settings (status stays Connected until you disconnect)."
        )
    elif config.GMAIL_MODE != "live":
        result["warning"] = "PILOT2_GMAIL_MODE is not 'live'. Poll is a no-op until set on Vercel."
    elif not syncable:
        result["warning"] = "No connected inboxes. Connect Gmail on Email accounts in the admin dashboard."
    return result


@router.post("/gmail/push")
async def gmail_push(request: Request, token: Optional[str] = None, db: Session = Depends(get_db)):
    """Gmail push webhook (Google Pub/Sub → here).

    Pub/Sub delivers `{"message": {"data": base64(JSON)}}` where the JSON is
    `{"emailAddress", "historyId"}`. We authenticate with a shared secret in
    the URL (?token=), then delta-sync that inbox immediately.

    We always ACK with 200 (even on internal errors) so Pub/Sub doesn't retry
    a poison message forever — the daily poll + next notification converge any
    missed change. Only a bad/absent token is rejected.
    """
    if config.GMAIL_PUSH_TOKEN and token != config.GMAIL_PUSH_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid push token.")

    try:
        envelope = await request.json()
    except Exception:
        return {"status": "ignored", "reason": "invalid JSON"}

    message = (envelope or {}).get("message") or {}
    data = message.get("data")
    if not data:
        return {"status": "ignored", "reason": "no data"}

    try:
        decoded = json.loads(base64.b64decode(data).decode("utf-8"))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return {"status": "ignored", "reason": "undecodable data"}

    email_address = decoded.get("emailAddress")
    history_id = decoded.get("historyId")
    try:
        changes = sync.handle_push_notification(db, email_address, history_id)
    except Exception:
        logger.exception("Gmail push handling failed for %s", email_address)
        db.rollback()
        return {"status": "error-acked", "changes": 0}

    return {"status": "ok", "inbox": email_address, "changes": changes}


@router.api_route("/gmail/watch/renew", methods=["GET", "POST"])
def renew_watches(request: Request, secret: Optional[str] = None, db: Session = Depends(get_db)):
    """Re-arm Gmail push watches nearing their 7-day expiry.

    Runs on a schedule (APScheduler in-process, or an external cron hitting
    this endpoint on serverless). Cron-secret protected like /poll."""
    require_cron_secret(request, secret)
    renewed = sync.renew_expiring_watches(db)
    result = {"renewed": renewed, "pushEnabled": config.gmail_push_enabled()}
    if not config.gmail_push_enabled():
        result["warning"] = (
            "Gmail push not configured. Set PILOT2_GMAIL_MODE=live and "
            "PILOT2_GMAIL_PUBSUB_TOPIC."
        )
    return result


# GET is allowed because hosted cron services typically only send GET requests.
@router.api_route("/learning/distill", methods=["GET", "POST"], response_model=schemas.DistillResultOut)
def trigger_distillation(request: Request, secret: Optional[str] = None, db: Session = Depends(get_db)):
    """Manual trigger for the learning job (also runs nightly on a schedule)."""
    require_cron_secret(request, secret)
    result = run_distillation(db)
    return {
        "editsProcessed": result.edits_processed,
        "intentsUpdated": result.intents_updated,
        "suggestionsCreated": result.suggestions_created,
    }


# ── Activity ─────────────────────────────────────────────────


@router.get("/activity", response_model=List[schemas.ProcessingLogOut])
def list_activity(limit: int = 25, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    return (
        db.query(models.ProcessingLog)
        .order_by(models.ProcessingLog.timestamp.desc())
        .limit(min(limit, 100))
        .all()
    )
