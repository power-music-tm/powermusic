"""Pydantic schemas for Pilot 2 (Inbound Email Management).

Field names are camelCase to match the frontend's mockData shapes so the
React app can swap its mock imports for API calls without remapping.
"""

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.input_validation import normalize_person_name, normalize_text


class InboxOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    partnerId: Optional[str] = Field(default=None, validation_alias="partner_id")
    email: str
    title: str
    status: str
    connectedAt: Optional[datetime] = Field(default=None, validation_alias="connected_at")
    lastSyncedAt: Optional[datetime] = Field(default=None, validation_alias="last_synced_at")
    backfillStatus: str = Field(default="idle", validation_alias="backfill_status")
    backfillImportedCount: int = Field(default=0, validation_alias="backfill_imported_count")
    backfillError: Optional[str] = Field(default=None, validation_alias="backfill_error")
    # Non-null when Gmail push is armed for this inbox (real-time delivery).
    watchExpiration: Optional[datetime] = Field(default=None, validation_alias="watch_expiration")


class InboxConnectIn(BaseModel):
    title: str
    email: str = ""
    partnerId: Optional[str] = None


class InboxUpdateIn(BaseModel):
    title: str
    partnerId: Optional[str] = None


class IgnoreRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    accountEmail: str = Field(validation_alias="account_email")
    kind: str
    pattern: str
    createdAt: datetime = Field(validation_alias="created_at")


class IgnoreRuleCreateIn(BaseModel):
    inbox: str
    pattern: str


class InboxSyncStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    email: str
    backfillStatus: str = Field(validation_alias="backfill_status")
    backfillImportedCount: int = Field(validation_alias="backfill_imported_count")
    backfillError: Optional[str] = Field(default=None, validation_alias="backfill_error")
    gmailHistoryId: Optional[str] = Field(default=None, validation_alias="gmail_history_id")
    lastSyncedAt: Optional[datetime] = Field(default=None, validation_alias="last_synced_at")


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    filename: str
    mimeType: str = Field(validation_alias="mime_type")
    sizeBytes: int = Field(default=0, validation_alias="size_bytes")
    isInline: bool = Field(default=False, validation_alias="is_inline")
    contentId: Optional[str] = Field(default=None, validation_alias="content_id")


class EmailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    from_: str = Field(validation_alias="from_name", serialization_alias="from")
    fromEmail: str = Field(validation_alias="from_email")
    toEmails: List[str] = Field(default_factory=list, validation_alias="to_emails")
    ccEmails: List[str] = Field(default_factory=list, validation_alias="cc_emails")
    subject: str
    inbox: str = Field(validation_alias="account_email")
    body: str
    htmlBody: Optional[str] = Field(default=None, validation_alias="html_body")
    snippet: Optional[str] = None
    receivedAt: datetime = Field(validation_alias="received_at")

    # Thread + RFC 5322 headers so the frontend can group / display / chain.
    gmailThreadId: Optional[str] = Field(default=None, validation_alias="gmail_thread_id")
    gmailMessageId: Optional[str] = Field(default=None, validation_alias="gmail_message_id")
    gmailIsOutbound: bool = Field(default=False, validation_alias="gmail_is_outbound")
    messageIdHeader: Optional[str] = Field(default=None, validation_alias="message_id_header")
    inReplyToHeader: Optional[str] = Field(default=None, validation_alias="in_reply_to_header")
    referencesHeader: Optional[str] = Field(default=None, validation_alias="references_header")

    # Forward pivot (top-level From vs. original sender when applicable).
    isForward: bool = Field(default=False, validation_alias="is_forward")
    forwardedByName: Optional[str] = Field(default=None, validation_alias="forwarded_by_name")
    forwardedByEmail: Optional[str] = Field(default=None, validation_alias="forwarded_by_email")
    originalFromName: Optional[str] = Field(default=None, validation_alias="original_from_name")
    originalFromEmail: Optional[str] = Field(default=None, validation_alias="original_from_email")

    intent: Optional[str] = None
    intentConfidence: Optional[int] = Field(default=None, validation_alias="intent_confidence")
    language: Optional[str] = None
    templateUsed: Optional[str] = Field(default=None, validation_alias="template_used")
    draftBody: Optional[str] = Field(default=None, validation_alias="draft_body")
    draftTweakLevel: Optional[str] = Field(default=None, validation_alias="draft_tweak_level")
    draftStatus: str = Field(validation_alias="draft_status")

    flagged: bool = False
    flagReason: Optional[str] = Field(default=None, validation_alias="flag_reason")
    urgent: bool = False
    read: bool = False
    archived: bool = False
    deleted: bool = False
    sentAt: Optional[datetime] = Field(default=None, validation_alias="sent_at")
    sentBody: Optional[str] = Field(default=None, validation_alias="sent_body")
    sentGmailMessageId: Optional[str] = Field(
        default=None, validation_alias="sent_gmail_message_id"
    )
    sentMessageIdHeader: Optional[str] = Field(
        default=None, validation_alias="sent_message_id_header"
    )

    attachments: List[AttachmentOut] = Field(default_factory=list)


class AttachmentIngestIn(BaseModel):
    filename: str = Field(max_length=500)
    mimeType: str = Field(default="application/octet-stream", max_length=255)
    contentBase64: Optional[str] = None
    sizeBytes: Optional[int] = None
    isInline: bool = False
    contentId: Optional[str] = None


class EmailIngestIn(BaseModel):
    """Simulates a new message arriving in a connected inbox (dev/testing,
    and the payload shape the Gmail poller feeds into the pipeline)."""

    inbox: str
    fromName: str
    fromEmail: str
    subject: str
    body: str
    receivedAt: Optional[datetime] = None
    gmailMessageId: Optional[str] = None
    gmailThreadId: Optional[str] = None
    # Everything below is optional metadata that mirrors real Gmail parsing —
    # tests can pass it in to exercise thread / forward flows deterministically.
    toEmails: Optional[List[str]] = None
    ccEmails: Optional[List[str]] = None
    htmlBody: Optional[str] = None
    snippet: Optional[str] = None
    messageIdHeader: Optional[str] = None
    inReplyToHeader: Optional[str] = None
    referencesHeader: Optional[str] = None
    isForward: bool = False
    forwardedByName: Optional[str] = None
    forwardedByEmail: Optional[str] = None
    originalFromName: Optional[str] = None
    originalFromEmail: Optional[str] = None
    # Optional inline attachments (base64) so mock-mode ingest can exercise the
    # attachment chip + download flow end-to-end without a live Gmail.
    attachments: Optional[List[AttachmentIngestIn]] = None


class EmailPatchIn(BaseModel):
    read: Optional[bool] = None
    flagged: Optional[bool] = None
    flagReason: Optional[str] = None
    archived: Optional[bool] = None
    deleted: Optional[bool] = None


class EmailBulkPatchIn(EmailPatchIn):
    """One request for many emails — keeps bulk toolbar actions to a single
    round trip instead of one PATCH per message."""

    ids: List[str]


class DraftUpdateIn(BaseModel):
    draftBody: str = Field(max_length=100_000)

    @field_validator("draftBody", mode="before")
    @classmethod
    def clean_draft(cls, value):
        return normalize_text(value, max_length=100_000, field_name="draftBody")


class SendIn(BaseModel):
    """Final body as it appears in the editor when the admin clicks Send."""

    finalBody: str = Field(max_length=100_000)

    @field_validator("finalBody", mode="before")
    @classmethod
    def clean_body(cls, value):
        return normalize_text(value, max_length=100_000, field_name="finalBody")


def _clean_email_list(values, *, field_name: str, max_len: int) -> List[str]:
    """Normalize a comma / whitespace separated list of email addresses into
    a de-duplicated, case-preserved list. Raises on any obviously malformed
    entry (missing '@'). Empty / whitespace inputs collapse to an empty list.
    """
    if values is None:
        return []
    if isinstance(values, str):
        raw = [part.strip() for part in values.replace(";", ",").split(",")]
    elif isinstance(values, (list, tuple)):
        raw = [str(part).strip() for part in values]
    else:
        raise ValueError(f"{field_name} must be a string or list")
    seen: set[str] = set()
    result: List[str] = []
    for addr in raw:
        if not addr:
            continue
        if "@" not in addr or " " in addr:
            raise ValueError(f"{field_name}: '{addr}' is not a valid email address")
        low = addr.lower()
        if low in seen:
            continue
        seen.add(low)
        result.append(addr)
    if len(result) > max_len:
        raise ValueError(f"{field_name}: at most {max_len} recipients allowed")
    return result


class ReplyAllIn(BaseModel):
    """Reply-all carries the To/Cc lists Andrea confirmed in the composer."""

    finalBody: str = Field(max_length=100_000)
    toEmails: List[str] = Field(default_factory=list)
    ccEmails: List[str] = Field(default_factory=list)

    @field_validator("finalBody", mode="before")
    @classmethod
    def clean_body(cls, value):
        return normalize_text(value, max_length=100_000, field_name="finalBody")

    @field_validator("toEmails", mode="before")
    @classmethod
    def clean_to_emails(cls, value):
        return _clean_email_list(value, field_name="toEmails", max_len=50)

    @field_validator("ccEmails", mode="before")
    @classmethod
    def clean_cc_emails(cls, value):
        return _clean_email_list(value, field_name="ccEmails", max_len=50)


class ForwardIn(BaseModel):
    """Forward the current message to a new set of recipients while staying
    inside the same Gmail thread (Gmail parity)."""

    finalBody: str = Field(max_length=100_000)
    toEmails: List[str] = Field(min_length=1)
    ccEmails: List[str] = Field(default_factory=list)

    @field_validator("finalBody", mode="before")
    @classmethod
    def clean_body(cls, value):
        return normalize_text(value, max_length=100_000, field_name="finalBody")

    @field_validator("toEmails", mode="before")
    @classmethod
    def clean_to(cls, value):
        return _clean_email_list(value, field_name="toEmails", max_len=50)

    @field_validator("ccEmails", mode="before")
    @classmethod
    def clean_cc(cls, value):
        return _clean_email_list(value, field_name="ccEmails", max_len=50)


class ComposeIn(BaseModel):
    """A brand-new outbound message Andrea writes herself (no AI, no thread).

    `inbox` is the connected account she's sending from; the rest mirror a
    Gmail compose window."""

    inbox: str = Field(max_length=254)
    toEmails: List[str] = Field(min_length=1)
    ccEmails: List[str] = Field(default_factory=list)
    bccEmails: List[str] = Field(default_factory=list)
    subject: str = Field(max_length=500)
    finalBody: str = Field(max_length=100_000)

    @field_validator("subject", mode="before")
    @classmethod
    def clean_subject(cls, value):
        return normalize_text(value, max_length=500, field_name="subject")

    @field_validator("finalBody", mode="before")
    @classmethod
    def clean_body(cls, value):
        return normalize_text(value, max_length=100_000, field_name="finalBody")

    @field_validator("toEmails", mode="before")
    @classmethod
    def clean_to(cls, value):
        return _clean_email_list(value, field_name="toEmails", max_len=50)

    @field_validator("ccEmails", mode="before")
    @classmethod
    def clean_cc(cls, value):
        return _clean_email_list(value, field_name="ccEmails", max_len=50)

    @field_validator("bccEmails", mode="before")
    @classmethod
    def clean_bcc(cls, value):
        return _clean_email_list(value, field_name="bccEmails", max_len=50)


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    inbox: str = Field(validation_alias="account_email")
    name: str
    category: str
    intent: Optional[str] = None
    status: str
    archivedFrom: Optional[str] = Field(default=None, validation_alias="archived_from")
    subject: str
    body: str
    timesUsed: int = Field(validation_alias="times_used")
    createdAt: Optional[datetime] = Field(default=None, validation_alias="created_at")
    lastUpdated: datetime = Field(validation_alias="last_updated")


class TemplateIn(BaseModel):
    inbox: str = Field(max_length=254)
    name: str = Field(max_length=200)
    category: str = Field(max_length=100)
    intent: Optional[str] = Field(default=None, max_length=50)
    status: str = Field(default="Active", max_length=20)
    subject: str = Field(max_length=500)
    body: str = Field(max_length=100_000)

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        return normalize_text(value, max_length=200, field_name="name")

    @field_validator("category", mode="before")
    @classmethod
    def clean_category(cls, value):
        return normalize_text(value, max_length=100, field_name="category")

    @field_validator("subject", mode="before")
    @classmethod
    def clean_subject(cls, value):
        return normalize_text(value, max_length=500, field_name="subject")

    @field_validator("body", mode="before")
    @classmethod
    def clean_template_body(cls, value):
        return normalize_text(value, max_length=100_000, field_name="body")


class TemplateUpdateIn(BaseModel):
    name: str = Field(max_length=200)
    category: str = Field(max_length=100)
    intent: Optional[str] = Field(default=None, max_length=50)
    status: str = Field(default="Active", max_length=20)
    subject: str = Field(max_length=500)
    body: str = Field(max_length=100_000)

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        return normalize_text(value, max_length=200, field_name="name")

    @field_validator("category", mode="before")
    @classmethod
    def clean_category(cls, value):
        return normalize_text(value, max_length=100, field_name="category")

    @field_validator("subject", mode="before")
    @classmethod
    def clean_subject(cls, value):
        return normalize_text(value, max_length=500, field_name="subject")

    @field_validator("body", mode="before")
    @classmethod
    def clean_template_body(cls, value):
        return normalize_text(value, max_length=100_000, field_name="body")


class GuidanceNoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    intent: str
    rules: List[str]
    version: int
    updatedAt: datetime = Field(validation_alias="updated_at")


class TemplateSuggestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    kind: str
    templateId: Optional[str] = Field(default=None, validation_alias="template_id")
    sourceEmailId: Optional[str] = Field(default=None, validation_alias="source_email_id")
    accountEmail: Optional[str] = Field(default=None, validation_alias="account_email")
    intent: Optional[str] = None
    suggestedName: str = Field(validation_alias="suggested_name")
    suggestedSubject: str = Field(validation_alias="suggested_subject")
    suggestedBody: str = Field(validation_alias="suggested_body")
    rationale: Optional[str] = None
    status: str
    createdAt: datetime = Field(validation_alias="created_at")


class ProcessingLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    timestamp: datetime
    type: str
    description: str
    emailId: Optional[str] = Field(default=None, validation_alias="email_id")


class DistillResultOut(BaseModel):
    editsProcessed: int
    intentsUpdated: List[str]
    suggestionsCreated: int


class OverviewActivityOut(BaseModel):
    id: str
    timestamp: datetime
    type: str
    description: str
    emailId: Optional[str] = None
    inboxTitle: Optional[str] = None


class Pilot2OverviewOut(BaseModel):
    newEmails: int
    flaggedEmails: int
    templatesActive: int
    activity: List[OverviewActivityOut]
    flaggedAlerts: List[dict] = Field(default_factory=list)


class Pilot2WorkspaceOut(BaseModel):
    emails: List[EmailOut]
    inboxes: List[InboxOut]
    # Emails imported but still awaiting AI classification/drafting. They are
    # kept out of `emails` so the visible queue only ever grows.
    pendingAiCount: int = 0
