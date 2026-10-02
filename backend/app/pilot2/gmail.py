"""Gmail integration.

Two modes, selected by PILOT2_GMAIL_MODE:
- "mock": no Google calls. Inboxes connect instantly, sends are recorded
  locally. This is the development default so the whole stack runs without
  Google Cloud credentials.
- "live": real Gmail API. OAuth per inbox (one-time consent screen), message
  polling, and replies sent inside the original thread.

Google client libraries are imported lazily so mock mode works without them
installed.
"""

import base64
import logging
import os
import re
import socket

# Google may return MORE scopes than requested (it merges previously granted
# ones). oauthlib treats that as an error by default; relax it — extra scopes
# are fine for us.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import getaddresses, make_msgid, parseaddr, parsedate_to_datetime
from typing import Iterable, List, Optional, Sequence, Tuple

from app import models
from app.pilot2 import config

logger = logging.getLogger(__name__)

# Full mail scope: gmail.modify covers read/trash/label changes, but the
# dashboard's "empty bin" must also permanently delete in Gmail, and
# messages.delete requires the full scope.
GMAIL_SCOPES = ["https://mail.google.com/"]

# System label ids returned by the Gmail API.
LABEL_INBOX = "INBOX"
LABEL_SENT = "SENT"
LABEL_TRASH = "TRASH"
LABEL_SPAM = "SPAM"
LABEL_STARRED = "STARRED"
LABEL_UNREAD = "UNREAD"
LABEL_DRAFT = "DRAFT"

# Bulk categories that are never customer enquiries in a support inbox.
# Genuinely ambiguous mail (Primary/Updates) still flows through and the AI
# classifier decides whether to ignore it.
NO_PROMOTIONS = "-category:promotions -category:social -category:forums"


@dataclass
class InboundAttachment:
    """Metadata for one attachment part parsed off a Gmail message.

    `gmail_attachment_id` fetches the bytes on demand (live). `content_base64`
    is only set when the bytes were already inline in the payload (small parts
    Gmail returns directly, and mock-mode test fixtures)."""

    filename: str
    mime_type: str
    size_bytes: int = 0
    gmail_attachment_id: Optional[str] = None
    content_base64: Optional[str] = None
    is_inline: bool = False
    content_id: Optional[str] = None


@dataclass
class InboundMessage:
    gmail_message_id: str
    gmail_thread_id: str
    from_name: str
    from_email: str
    subject: str
    body: str
    received_at: datetime
    label_ids: List[str] = field(default_factory=list)
    attachments: List[InboundAttachment] = field(default_factory=list)
    # True when bulk/automated-mail headers are present (List-Unsubscribe,
    # Precedence: bulk/list, Auto-Submitted). Real customers never set these.
    is_automated: bool = False

    # Envelope recipients (unique email addresses only; display names dropped).
    to_emails: List[str] = field(default_factory=list)
    cc_emails: List[str] = field(default_factory=list)

    # RFC 5322 threading headers as they appeared on the wire (with `<>`).
    message_id_header: Optional[str] = None
    in_reply_to_header: Optional[str] = None
    references_header: Optional[str] = None  # space-separated list

    # HTML body (only when Gmail supplied a text/html part) + Gmail snippet.
    html_body: Optional[str] = None
    snippet: Optional[str] = None

    # Forward pivot. When a colleague forwards a customer email to Andrea, the
    # top-level From is the colleague, but she wants to reply to the original
    # customer. We surface the pivot on the message so the composer + UI can
    # address the right person automatically.
    is_forward: bool = False
    forwarded_by_name: Optional[str] = None
    forwarded_by_email: Optional[str] = None
    original_from_name: Optional[str] = None
    original_from_email: Optional[str] = None


def is_no_reply_address(address: str) -> bool:
    """True for addresses that cannot receive replies (no-reply@, bounces, …)."""
    local = (address or "").split("@", 1)[0].lower()
    if local in {"mailer-daemon", "postmaster", "bounce", "bounces"}:
        return True
    compact = local.replace("-", "").replace(".", "").replace("_", "")
    return "noreply" in compact or "donotreply" in compact


def _is_automated_headers(headers: dict) -> bool:
    if "list-unsubscribe" in headers or "list-id" in headers:
        return True
    if headers.get("auto-submitted", "").lower().startswith("auto"):
        return True
    if headers.get("precedence", "").lower() in {"bulk", "list", "junk", "auto_reply"}:
        return True
    # Bulk-ESP feedback-loop marker (Amazon SES, SendGrid, …); never present
    # on mail a human wrote in a mail client.
    if "feedback-id" in headers or "x-ses-outgoing" in headers:
        return True
    # Replies routed to a dead mailbox = notification, not correspondence
    # (e.g. Vercel alerts: From notifications@ with Reply-To no-reply@).
    _, reply_to = parseaddr(headers.get("reply-to", ""))
    if reply_to and is_no_reply_address(reply_to):
        return True
    return False


def is_live() -> bool:
    return config.GMAIL_MODE == "live"


def is_auth_revoked_error(exc: BaseException) -> bool:
    """True when Google rejected the refresh token (expired, revoked, or deleted)."""
    text = str(exc).lower()
    name = type(exc).__name__.lower()
    return (
        "invalid_grant" in text
        or "token has been expired or revoked" in text
        or ("refresherror" in name and "revoked" in text)
    )


def mark_account_auth_revoked(db, account: models.EmailAccount, exc: BaseException) -> None:
    """Record that Gmail OAuth stopped working, without disconnecting the inbox.

    Status stays Connected until an admin clicks Disconnect or completes Reconnect
    (same mental model as Google's connected apps). Clears the unusable refresh
    token and flags the inbox so the UI can prompt for reconnect.
    """
    logger.error(
        "Gmail OAuth revoked for %s — staying Connected, needs reconnect (%s)",
        account.email,
        exc,
    )
    account.status = "Connected"
    account.oauth_refresh_token = None
    account.watch_expiration = None
    account.backfill_error = "oauth_revoked"
    db.commit()


# ── OAuth ────────────────────────────────────────────────────


def _flow():
    from google_auth_oauthlib.flow import Flow

    return Flow.from_client_config(
        {
            "web": {
                "client_id": config.GOOGLE_CLIENT_ID,
                "client_secret": config.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=GMAIL_SCOPES,
        redirect_uri=config.GOOGLE_REDIRECT_URI,
    )


# PKCE verifiers by OAuth state. The authorization URL carries a one-time
# code challenge; the callback must present the matching verifier, so it is
# kept here between the two requests. (Single-process only — fine for this
# pilot; move to the database if the API ever runs on multiple workers.)
_code_verifiers: dict = {}


def get_authorization_url(state: str) -> str:
    flow = _flow()
    # No include_granted_scopes: merging previously granted scopes into the
    # token response is what trips oauthlib's scope check on reconnects.
    url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",  # force refresh_token issuance on reconnect
        state=state,
    )
    _code_verifiers[state] = flow.code_verifier
    return url


def exchange_code(code: str, state: str) -> Tuple[str, Optional[str]]:
    """Exchange the OAuth callback code. Returns (email, refresh_token).

    refresh_token may be None on re-consent when Google does not re-issue one —
    callers must keep the previously stored token in that case.
    """
    flow = _flow()
    verifier = _code_verifiers.pop(state, None)
    if verifier:
        flow.code_verifier = verifier
    flow.fetch_token(code=code)
    credentials = flow.credentials
    service = _service_from_credentials(credentials)
    profile = service.users().getProfile(userId="me").execute()
    return profile["emailAddress"], credentials.refresh_token


def _service_from_credentials(credentials):
    from googleapiclient.discovery import build

    return build("gmail", "v1", credentials=credentials, cache_discovery=False)


def _service_for_account(account: models.EmailAccount):
    from google.oauth2.credentials import Credentials

    from app.pilot2 import token_crypto

    # scopes=None → refresh with whatever scopes the token was granted.
    # Pinning GMAIL_SCOPES here breaks tokens issued under the older, narrower
    # scope (invalid_scope on refresh); permanent-delete simply degrades to
    # trash until the inbox is reconnected with the full scope.
    credentials = Credentials(
        token=None,
        refresh_token=token_crypto.decrypt_token(account.oauth_refresh_token),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=config.GOOGLE_CLIENT_ID,
        client_secret=config.GOOGLE_CLIENT_SECRET,
        scopes=None,
    )
    return _service_from_credentials(credentials)


# ── Reading ──────────────────────────────────────────────────


def _decode_body_part(payload, mime_type: str) -> str:
    """Return the first payload part whose mimeType matches, decoded to text."""
    if payload.get("mimeType") == mime_type and payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", "replace")
    for part in payload.get("parts", []) or []:
        text = _decode_body_part(part, mime_type)
        if text:
            return text
    return ""


def _decode_part(payload) -> str:
    """Plain-text body (legacy helper). Kept for backward compat in callers."""
    return _decode_body_part(payload, "text/plain")


def _strip_angles(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return value.strip().strip("<>").strip() or None


def _collect_attachments(payload, out: List["InboundAttachment"]) -> None:
    """Walk the MIME tree collecting attachment parts.

    A part is an attachment when it carries a filename, or when it's an inline
    part (Content-Id) that isn't the message body itself. The body text/plain
    and text/html parts (which have no filename) are skipped.
    """
    filename = payload.get("filename") or ""
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", []) or []}
    content_id = _strip_angles(headers.get("content-id"))
    disposition = (headers.get("content-disposition") or "").lower()
    body = payload.get("body", {}) or {}

    is_inline = "inline" in disposition or bool(content_id)
    looks_like_attachment = bool(filename) or (is_inline and payload.get("mimeType", "").split("/")[0] in {"image", "application"})

    if looks_like_attachment and (body.get("attachmentId") or body.get("data")):
        out.append(
            InboundAttachment(
                filename=filename or (content_id or "attachment"),
                mime_type=payload.get("mimeType") or "application/octet-stream",
                size_bytes=int(body.get("size") or 0),
                gmail_attachment_id=body.get("attachmentId"),
                content_base64=body.get("data"),
                is_inline=is_inline and not (disposition.startswith("attachment")),
                content_id=content_id,
            )
        )
        return

    for part in payload.get("parts", []) or []:
        _collect_attachments(part, out)


def _unique_emails(header_value: Optional[str]) -> List[str]:
    """Parse an address-list header into unique, lowercased email addresses."""
    if not header_value:
        return []
    seen: dict[str, None] = {}
    for _, addr in getaddresses([header_value]):
        if not addr:
            continue
        lowered = addr.strip().lower()
        if lowered:
            seen.setdefault(lowered, None)
    return list(seen.keys())


# Subject-line markers used by every major mail client for forwards. We check
# the localised prefixes (`Fwd:`, `FW:`, `TR:` fr, `WG:` de, `RV:` es, `転送:` ja)
# because they're stable across clients — body-quote markers are the fallback.
_FWD_SUBJECT_RE = re.compile(
    r"^\s*(fwd?|fw|tr|wg|rv|転送)\s*:\s*",
    re.IGNORECASE,
)
_FWD_BODY_MARKER_RE = re.compile(
    r"^-{5,}\s*(forwarded message|original message)\s*-{5,}\s*$",
    re.IGNORECASE | re.MULTILINE,
)
# Header line that follows a Gmail-style forward marker: "From: name <addr>".
_FWD_FROM_LINE_RE = re.compile(
    r"^\s*From:\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)


def _detect_forward(
    subject: str,
    body: str,
    from_name: str,
    from_email: str,
) -> Tuple[bool, Optional[str], Optional[str]]:
    """Best-effort detection of a client-forward wrapping a prior sender.

    Returns (is_forward, original_from_name, original_from_email). A subject
    prefix alone is enough to flag the message; extracting the original sender
    requires the Gmail-style body marker + a following "From:" line.
    """
    subject_hit = bool(_FWD_SUBJECT_RE.match(subject or ""))
    marker = _FWD_BODY_MARKER_RE.search(body or "") if body else None
    if not subject_hit and marker is None:
        return False, None, None

    original_name, original_email = None, None
    if marker is not None:
        tail = body[marker.end() :]
        from_line = _FWD_FROM_LINE_RE.search(tail)
        if from_line:
            name, addr = parseaddr(from_line.group(1))
            if addr and addr.lower() != (from_email or "").lower():
                original_name = name or None
                original_email = addr

    return True, original_name, original_email


def _parse_full_message(full: dict) -> InboundMessage:
    headers = {h["name"].lower(): h["value"] for h in full["payload"].get("headers", [])}
    from_name, from_email = parseaddr(headers.get("from", ""))
    try:
        received_at = parsedate_to_datetime(headers.get("date", ""))
    except (TypeError, ValueError):
        received_at = datetime.now(timezone.utc)

    body_plain = _decode_body_part(full["payload"], "text/plain")
    body_html = _decode_body_part(full["payload"], "text/html")

    attachments: List[InboundAttachment] = []
    _collect_attachments(full["payload"], attachments)

    subject = headers.get("subject", "(no subject)")
    is_forward, original_from_name, original_from_email = _detect_forward(
        subject, body_plain, from_name, from_email
    )

    return InboundMessage(
        gmail_message_id=full["id"],
        gmail_thread_id=full.get("threadId", full["id"]),
        from_name=from_name or from_email or "Unknown Sender",
        from_email=from_email or "unknown@unknown",
        subject=subject,
        body=body_plain,
        received_at=received_at,
        label_ids=list(full.get("labelIds") or []),
        attachments=attachments,
        is_automated=_is_automated_headers(headers),
        to_emails=_unique_emails(headers.get("to")),
        cc_emails=_unique_emails(headers.get("cc")),
        message_id_header=headers.get("message-id"),
        in_reply_to_header=headers.get("in-reply-to"),
        references_header=headers.get("references"),
        html_body=body_html or None,
        snippet=full.get("snippet"),
        is_forward=is_forward,
        forwarded_by_name=(from_name or None) if is_forward else None,
        forwarded_by_email=(from_email or None) if is_forward else None,
        original_from_name=original_from_name,
        original_from_email=original_from_email,
    )


def fetch_new_messages(account: models.EmailAccount, known_ids: set) -> List[InboundMessage]:
    """Pull recent inbox messages not yet in our database (legacy fallback)."""
    if not is_live():
        return []

    service = _service_for_account(account)
    listing = (
        service.users()
        .messages()
        .list(
            userId="me",
            q=f"newer_than:2d in:inbox {NO_PROMOTIONS}",
            maxResults=50,
        )
        .execute()
    )
    messages = []
    for ref in listing.get("messages", []) or []:
        if ref["id"] in known_ids:
            continue
        full = service.users().messages().get(userId="me", id=ref["id"], format="full").execute()
        messages.append(_parse_full_message(full))
    return messages


def list_message_ids(
    account: models.EmailAccount,
    query: str,
    *,
    page_token: Optional[str] = None,
    max_results: int = 100,
) -> Tuple[List[str], Optional[str]]:
    """One page of Gmail message ids for a search query."""
    if not is_live():
        return [], None
    service = _service_for_account(account)
    listing = (
        service.users()
        .messages()
        .list(
            userId="me",
            q=query,
            maxResults=max_results,
            pageToken=page_token,
        )
        .execute()
    )
    ids = [ref["id"] for ref in listing.get("messages", []) or []]
    return ids, listing.get("nextPageToken")


def list_all_message_ids(
    account: models.EmailAccount,
    query: str,
    *,
    max_messages: int = 500,
    pause_seconds: float = 0.08,
) -> List[str]:
    """Paginate a Gmail search query up to max_messages ids."""
    import time

    collected: List[str] = []
    page_token: Optional[str] = None
    while len(collected) < max_messages:
        batch, page_token = list_message_ids(
            account,
            query,
            page_token=page_token,
            max_results=min(100, max_messages - len(collected)),
        )
        if not batch:
            break
        collected.extend(batch)
        if pause_seconds:
            time.sleep(pause_seconds)
        if not page_token:
            break
    return collected[:max_messages]


def get_profile(account: models.EmailAccount) -> dict:
    if not is_live():
        return {"historyId": "0", "emailAddress": account.email}
    service = _service_for_account(account)
    return service.users().getProfile(userId="me").execute()


def list_history(
    account: models.EmailAccount,
    start_history_id: str,
    *,
    page_token: Optional[str] = None,
) -> dict:
    if not is_live():
        return {"history": [], "historyId": start_history_id}
    service = _service_for_account(account)
    return (
        service.users()
        .history()
        .list(
            userId="me",
            startHistoryId=start_history_id,
            historyTypes=["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
            pageToken=page_token,
        )
        .execute()
    )


def start_watch(account: models.EmailAccount) -> dict:
    """Arm Gmail push notifications for this inbox to the configured Pub/Sub
    topic. Returns Gmail's response ({'historyId', 'expiration'} in ms) or {}
    when push is not configured / mock mode.

    Scoped to the INBOX label so we're only pinged for mail Andrea would see,
    not every label churn across the mailbox.
    """
    if not is_live() or not config.GMAIL_PUBSUB_TOPIC:
        return {}
    service = _service_for_account(account)
    return (
        service.users()
        .watch(
            userId="me",
            body={
                "topicName": config.GMAIL_PUBSUB_TOPIC,
                "labelIds": [LABEL_INBOX],
                "labelFilterBehavior": "INCLUDE",
            },
        )
        .execute()
    )


def stop_watch(account: models.EmailAccount) -> None:
    """Disarm Gmail push for this inbox (best-effort; used on disconnect)."""
    if not is_live():
        return
    service = _service_for_account(account)
    try:
        service.users().stop(userId="me").execute()
    except Exception:
        logger.exception("Gmail watch stop failed for %s", account.email)


def thread_has_sent(account: models.EmailAccount, thread_id: str) -> bool:
    """True when this Gmail thread already contains a message sent by the account."""
    if not is_live() or not thread_id:
        return False
    service = _service_for_account(account)
    thread = (
        service.users()
        .threads()
        .get(userId="me", id=thread_id, format="metadata", metadataHeaders=[])
        .execute()
    )
    for msg in thread.get("messages", []) or []:
        if LABEL_SENT in (msg.get("labelIds") or []):
            return True
    return False


def get_message(account: models.EmailAccount, message_id: str) -> Optional[InboundMessage]:
    """Fetch one full message by Gmail id."""
    if not is_live():
        return None
    service = _service_for_account(account)
    full = service.users().messages().get(userId="me", id=message_id, format="full").execute()
    return _parse_full_message(full)


def fetch_label_ids(account: models.EmailAccount, label: str, max_pages: int = 2) -> set:
    """Gmail message ids carrying one label (TRASH, UNREAD, INBOX, ...).

    Paged to max_pages*100 most recent messages — plenty for the emails this
    dashboard tracks.
    """
    if not is_live():
        return set()
    service = _service_for_account(account)
    ids, page_token = set(), None
    for _ in range(max_pages):
        listing = (
            service.users()
            .messages()
            .list(userId="me", labelIds=[label], maxResults=100, pageToken=page_token)
            .execute()
        )
        ids |= {ref["id"] for ref in listing.get("messages", []) or []}
        page_token = listing.get("nextPageToken")
        if not page_token:
            break
    return ids


def fetch_message(account: models.EmailAccount, message_id: str) -> Optional[InboundMessage]:
    """Fetch one full message (used to show Gmail-trashed mail we never saw)."""
    return get_message(account, message_id)


# ── Writing state back to Gmail ──────────────────────────────


def modify_labels_batch(account: models.EmailAccount, message_ids: list,
                        add_labels: list, remove_labels: list) -> None:
    """One batched label change for many messages (read/unread, archive)."""
    if not is_live() or not message_ids:
        return
    service = _service_for_account(account)
    service.users().messages().batchModify(
        userId="me",
        body={"ids": message_ids, "addLabelIds": add_labels, "removeLabelIds": remove_labels},
    ).execute()


def trash_message(account: models.EmailAccount, message_id: str) -> None:
    if not is_live():
        return
    service = _service_for_account(account)
    service.users().messages().trash(userId="me", id=message_id).execute()


def untrash_message(account: models.EmailAccount, message_id: str) -> None:
    if not is_live():
        return
    service = _service_for_account(account)
    service.users().messages().untrash(userId="me", id=message_id).execute()


def delete_message_forever(account: models.EmailAccount, message_id: str) -> None:
    """Permanent Gmail delete. Falls back to trash when the connected token
    only has the older gmail.modify scope (reconnect upgrades it)."""
    if not is_live():
        return
    service = _service_for_account(account)
    try:
        service.users().messages().delete(userId="me", id=message_id).execute()
    except Exception:
        logger.warning(
            "Permanent delete failed for %s (token may lack full scope); trashing instead",
            message_id,
        )
        service.users().messages().trash(userId="me", id=message_id).execute()


# ── Sending ──────────────────────────────────────────────────


@dataclass
class SendResult:
    """Everything the send path returns to callers so they can persist an
    outbound row that Gmail's history sync will later dedupe against."""

    gmail_message_id: Optional[str]
    gmail_thread_id: Optional[str]
    message_id_header: str
    in_reply_to_header: Optional[str]
    references_header: Optional[str]
    to_emails: List[str]
    cc_emails: List[str]
    subject: str
    body: str


def _domain_for_message_id(account_email: str) -> str:
    """Domain used for our locally-generated Message-Id when we cannot read
    Gmail's post-send one back. Prefer the account's own domain."""
    if "@" in (account_email or ""):
        return account_email.split("@", 1)[1] or socket.getfqdn() or "local"
    return socket.getfqdn() or "local"


def _reply_subject(subject: Optional[str]) -> str:
    subject = subject or ""
    return subject if subject.lower().startswith("re:") else f"Re: {subject}"


def _forward_subject(subject: Optional[str]) -> str:
    subject = subject or ""
    return subject if subject.lower().startswith(("fwd:", "fw:")) else f"Fwd: {subject}"


def _build_references_header(email_row: models.Email) -> Optional[str]:
    """Chain the inbound message's own Message-Id onto its References so the
    outbound reply threads correctly in RFC-strict clients (Outlook, Apple Mail).
    """
    existing = (email_row.references_header or "").strip()
    parent = (email_row.message_id_header or "").strip()
    parts: list[str] = []
    if existing:
        parts.extend(existing.split())
    if parent and parent not in parts:
        parts.append(parent)
    return " ".join(parts) if parts else None


def _addresses_string(addresses: Sequence[str]) -> str:
    return ", ".join(addr for addr in addresses if addr)


def _apply_threading_headers(
    message: EmailMessage,
    *,
    in_reply_to: Optional[str],
    references: Optional[str],
) -> None:
    if in_reply_to:
        message["In-Reply-To"] = in_reply_to
    if references:
        message["References"] = references


def _generate_message_id(account_email: str) -> str:
    """RFC 5322 Message-Id. Uses stdlib helper; deterministic enough per send
    (make_msgid uses time + os.getpid + a random token)."""
    return make_msgid(domain=_domain_for_message_id(account_email))


def _send_and_record(
    account: models.EmailAccount,
    *,
    to_emails: Sequence[str],
    cc_emails: Sequence[str],
    bcc_emails: Sequence[str] = (),
    subject: str,
    body: str,
    in_reply_to: Optional[str],
    references: Optional[str],
    gmail_thread_id: Optional[str],
) -> SendResult:
    """Common send path shared by reply / reply-all / forward.

    In mock mode nothing hits Gmail; we still return a filled SendResult so
    the local outbound row can be persisted with realistic threading headers.
    """
    message_id_header = _generate_message_id(account.email)
    to_line = _addresses_string(to_emails)
    cc_line = _addresses_string(cc_emails)
    bcc_line = _addresses_string(bcc_emails)

    if not is_live():
        logger.info("[mock gmail] send from %s to %s (thread=%s)",
                    account.email, to_line or "?", gmail_thread_id)
        return SendResult(
            gmail_message_id=None,
            gmail_thread_id=gmail_thread_id,
            message_id_header=message_id_header,
            in_reply_to_header=in_reply_to,
            references_header=references,
            to_emails=list(to_emails),
            cc_emails=list(cc_emails),
            subject=subject,
            body=body,
        )

    message = EmailMessage()
    message["To"] = to_line
    if cc_line:
        message["Cc"] = cc_line
    if bcc_line:
        message["Bcc"] = bcc_line
    message["From"] = account.email
    message["Subject"] = subject
    message["Message-Id"] = message_id_header
    _apply_threading_headers(message, in_reply_to=in_reply_to, references=references)
    message.set_content(body)

    payload = {"raw": base64.urlsafe_b64encode(message.as_bytes()).decode()}
    if gmail_thread_id:
        payload["threadId"] = gmail_thread_id

    service = _service_for_account(account)
    sent = service.users().messages().send(userId="me", body=payload).execute()

    return SendResult(
        gmail_message_id=sent.get("id"),
        gmail_thread_id=sent.get("threadId") or gmail_thread_id,
        message_id_header=message_id_header,
        in_reply_to_header=in_reply_to,
        references_header=references,
        to_emails=list(to_emails),
        cc_emails=list(cc_emails),
        subject=subject,
        body=body,
    )


def send_reply(account: models.EmailAccount, email_row: models.Email, body: str) -> SendResult:
    """Send the reply inside the original Gmail thread, with RFC-correct
    Message-Id / In-Reply-To / References so it threads outside Gmail too."""
    # When Andrea is replying to a forwarded email the intended recipient is
    # the *original* customer, not the colleague who forwarded it in.
    if email_row.is_forward and email_row.original_from_email:
        primary_to = email_row.original_from_email
    else:
        primary_to = email_row.from_email

    return _send_and_record(
        account,
        to_emails=[primary_to],
        cc_emails=[],
        subject=_reply_subject(email_row.subject),
        body=body,
        in_reply_to=email_row.message_id_header,
        references=_build_references_header(email_row),
        gmail_thread_id=email_row.gmail_thread_id,
    )


def send_reply_all(
    account: models.EmailAccount,
    email_row: models.Email,
    body: str,
    *,
    to_emails: Iterable[str] = (),
    cc_emails: Iterable[str] = (),
) -> SendResult:
    """Reply-all with explicit To/Cc from the composer (Gmail parity)."""
    self_email = (account.email or "").lower()

    if email_row.is_forward and email_row.original_from_email:
        default_to = email_row.original_from_email
    else:
        default_to = email_row.from_email

    to = [addr.strip() for addr in to_emails if addr and addr.strip()]
    if not to:
        to = [default_to]

    to_lower = {addr.lower() for addr in to}
    cc: list[str] = []
    seen: dict[str, None] = {}
    for addr in cc_emails:
        if not addr:
            continue
        low = addr.strip().lower()
        if low == self_email or low in to_lower:
            continue
        if low in seen:
            continue
        seen[low] = None
        cc.append(addr.strip())

    return _send_and_record(
        account,
        to_emails=to,
        cc_emails=cc,
        subject=_reply_subject(email_row.subject),
        body=body,
        in_reply_to=email_row.message_id_header,
        references=_build_references_header(email_row),
        gmail_thread_id=email_row.gmail_thread_id,
    )


def send_forward(
    account: models.EmailAccount,
    email_row: models.Email,
    body: str,
    *,
    to_emails: Sequence[str],
    cc_emails: Sequence[str] = (),
) -> SendResult:
    """Forward the message to a new set of recipients on the same Gmail thread.

    Forwards on the SAME thread is a Gmail-specific convenience: RFC-wise a
    forward is a new message referencing the original, and we preserve that
    via In-Reply-To / References so cross-client threading still works.
    """
    if not to_emails:
        raise ValueError("send_forward requires at least one recipient")

    return _send_and_record(
        account,
        to_emails=list(to_emails),
        cc_emails=list(cc_emails),
        subject=_forward_subject(email_row.subject),
        body=body,
        in_reply_to=email_row.message_id_header,
        references=_build_references_header(email_row),
        gmail_thread_id=email_row.gmail_thread_id,
    )


def fetch_attachment(
    account: models.EmailAccount,
    gmail_message_id: str,
    attachment_id: str,
) -> bytes:
    """Fetch one attachment's raw bytes from Gmail on demand (live only).

    Gmail delivers attachment bodies behind a separate handle rather than
    inline, so downloads are fetched lazily here at click time.
    """
    if not is_live():
        raise RuntimeError("Attachment fetch requires a live Gmail connection.")
    service = _service_for_account(account)
    part = (
        service.users()
        .messages()
        .attachments()
        .get(userId="me", messageId=gmail_message_id, id=attachment_id)
        .execute()
    )
    return base64.urlsafe_b64decode(part["data"])


def send_new_message(
    account: models.EmailAccount,
    *,
    to_emails: Sequence[str],
    subject: str,
    body: str,
    cc_emails: Sequence[str] = (),
    bcc_emails: Sequence[str] = (),
) -> SendResult:
    """Send a brand-new message that starts its own thread.

    Unlike reply / reply-all / forward there is no parent message, so we set
    no In-Reply-To / References and pass no threadId — Gmail assigns a fresh
    thread. This backs Andrea's Gmail-style "Compose" button.
    """
    if not to_emails:
        raise ValueError("send_new_message requires at least one recipient")

    return _send_and_record(
        account,
        to_emails=list(to_emails),
        cc_emails=list(cc_emails),
        bcc_emails=list(bcc_emails),
        subject=subject,
        body=body,
        in_reply_to=None,
        references=None,
        gmail_thread_id=None,
    )
