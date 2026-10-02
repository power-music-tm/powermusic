from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, String, Text, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class PowermusicUser(Base):
    """App user linked to Supabase auth (role source of truth for API authorization)."""

    __tablename__ = "powermusic_users"

    id = Column(UUID(as_uuid=True), primary_key=True)
    email = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    club = Column(String, nullable=True)
    role = Column(String, nullable=False)
    manager_request_total = Column(Integer, nullable=False, server_default="0")
    manager_request_pending = Column(Integer, nullable=False, server_default="0")


# Backward-compatible alias
Profile = PowermusicUser


class Partner(Base):
    """Independent partner workspace that owns request intake configuration."""

    __tablename__ = "partners"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class ManagerRequest(Base):
    """Single table for manager submissions (new) and handled directory entries."""

    __tablename__ = "manager_requests"

    id = Column(String, primary_key=True)
    received_at = Column(DateTime(timezone=True), nullable=False)
    handled_at = Column(DateTime(timezone=True), nullable=True)

    manager_id = Column(UUID(as_uuid=True), ForeignKey("powermusic_users.id"), nullable=True)
    handled_by_admin_id = Column(UUID(as_uuid=True), ForeignKey("powermusic_users.id"), nullable=True)

    person_first_name = Column(String, nullable=False)
    person_last_name = Column(String, nullable=False)
    person_email = Column(String, nullable=False)
    # Stores "location" for PureGym and "client" for Health Fitness.
    # The distinction is handled at the presentation layer via partner config.
    person_location = Column(String, nullable=False)
    role = Column(String, nullable=True)

    action = Column(String, nullable=False)
    manager_notes = Column(Text, nullable=True)
    admin_notes = Column(Text, nullable=True)
    tags = Column(ARRAY(String), nullable=False, server_default="{}")
    status = Column(String, nullable=False)
    outcome = Column(String, nullable=True)
    source_email_id = Column(String, ForeignKey("emails.id"), nullable=True, unique=True)
    source_gmail_message_id = Column(String, nullable=True, unique=True)
    intake_persons = Column(JSONB, nullable=False, server_default="{}")
    partner_id = Column(String, ForeignKey("partners.id"), nullable=True, index=True)
    archived_at = Column(DateTime(timezone=True), nullable=True, index=True)
    duplicate_group_id = Column(String, ForeignKey("duplicate_groups.id"), nullable=True, index=True)


class DuplicateGroup(Base):
    """Group of related/duplicate manager requests for the same identity probe.

    resolution_metadata stores an audit snapshot at resolve time:
      {
        "resolution_type": "add" | "update" | "keep_existing",
        "final_values": {firstName, lastName, email, location},
        "previous_values": {firstName, lastName, email, location},  # update only
        "admin_note": "..."
      }
    """

    __tablename__ = "duplicate_groups"

    id = Column(String, primary_key=True)
    partner_id = Column(String, ForeignKey("partners.id"), nullable=True, index=True)
    classification = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by_admin_id = Column(UUID(as_uuid=True), ForeignKey("powermusic_users.id"), nullable=True)
    directory_person_id = Column(String, ForeignKey("manager_requests.id"), nullable=True)
    representative_request_id = Column(String, ForeignKey("manager_requests.id"), nullable=True)
    resolution_metadata = Column(JSONB, nullable=True)


class DismissedDuplicateMatch(Base):
    """Admin decision persistence to dismiss/unlink a false-positive duplicate pair."""

    __tablename__ = "dismissed_duplicate_matches"

    id = Column(String, primary_key=True)
    request_id_1 = Column(String, ForeignKey("manager_requests.id"), nullable=False, index=True)
    request_id_2 = Column(String, ForeignKey("manager_requests.id"), nullable=False, index=True)
    dismissed_by_admin_id = Column(UUID(as_uuid=True), ForeignKey("powermusic_users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)


class DismissedGroupMatch(Base):
    """Admin decision persistence to permanently exclude a request from rejoining a specific group."""

    __tablename__ = "dismissed_group_matches"

    id = Column(String, primary_key=True)
    request_id = Column(String, ForeignKey("manager_requests.id"), nullable=False, index=True)
    group_id = Column(String, ForeignKey("duplicate_groups.id"), nullable=False, index=True)
    dismissed_by_admin_id = Column(UUID(as_uuid=True), ForeignKey("powermusic_users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)


class ManagerRequestView(Base):
    """When a manager last viewed a handled request (unread until seen_at >= handled_at)."""

    __tablename__ = "manager_request_views"

    manager_id = Column(UUID(as_uuid=True), ForeignKey("powermusic_users.id"), primary_key=True)
    request_id = Column(String, ForeignKey("manager_requests.id"), primary_key=True)
    seen_at = Column(DateTime(timezone=True), nullable=False)


class ManagerSubmissionJob(Base):
    """Queued manager batch submissions processed by cron."""

    __tablename__ = "manager_submission_jobs"

    id = Column(String, primary_key=True)
    manager_id = Column(UUID(as_uuid=True), ForeignKey("powermusic_users.id"), nullable=True)
    status = Column(String, nullable=False, default="pending")
    payload = Column(JSONB, nullable=False)
    result = Column(JSONB, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)


class ApiRateLimitBucket(Base):
    """Shared rate-limit counters across serverless instances."""

    __tablename__ = "api_rate_limit_buckets"

    rate_key = Column(String, primary_key=True)
    window_start = Column(Integer, primary_key=True)
    hit_count = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), nullable=False)


# Backward-compatible alias used across the codebase during refactor.
Request = ManagerRequest


# ─────────────────────────────────────────────────────────────
#  Pilot 2 · Inbound Email Management
# ─────────────────────────────────────────────────────────────


class EmailAccount(Base):
    """A connected Gmail inbox (one per business vertical)."""

    __tablename__ = "connected_emails"

    id = Column(String, primary_key=True)
    partner_id = Column(String, ForeignKey("partners.id"), nullable=True, index=True)
    email = Column(String, nullable=False, unique=True)
    title = Column(String, nullable=False)
    status = Column(String, nullable=False, default="Disconnected")  # Connected | Disconnected
    connected_at = Column(DateTime(timezone=True), nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)

    # OAuth material issued by Google for this inbox. Refresh token is the
    # long-lived credential; access tokens are re-minted from it on demand.
    oauth_refresh_token = Column(Text, nullable=True)
    gmail_history_id = Column(String, nullable=True)
    # When the Gmail push `watch` for this inbox expires (Gmail caps it at 7
    # days). The renew job re-arms any watch within 24h of this time. Null =
    # push not armed (mock mode, or no Pub/Sub topic configured).
    watch_expiration = Column(DateTime(timezone=True), nullable=True)

    # Initial Gmail backfill (last N days on first connect).
    backfill_status = Column(String, nullable=False, default="idle")  # idle|running|done|failed
    backfill_imported_count = Column(Integer, nullable=False, default=0)
    backfill_error = Column(Text, nullable=True)


class EmailIgnoreRule(Base):
    """Sender blocklist entry — email or whole domain hidden from Email responses."""

    __tablename__ = "email_ignore_rules"

    id = Column(String, primary_key=True)
    account_email = Column(String, nullable=False, index=True)
    kind = Column(String, nullable=False)  # email | domain
    pattern = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)


class Email(Base):
    """An inbound email plus the AI-generated draft attached to it."""

    __tablename__ = "emails"

    id = Column(String, primary_key=True)
    account_email = Column(String, nullable=False, index=True)
    gmail_message_id = Column(String, nullable=True, unique=True)
    gmail_thread_id = Column(String, nullable=True)
    gmail_label_ids = Column(ARRAY(String), nullable=False, server_default="{}")

    # Snapshot of Gmail label state (derived on import / history sync).
    gmail_in_inbox = Column(Boolean, nullable=False, default=False)
    gmail_in_trash = Column(Boolean, nullable=False, default=False)
    gmail_in_sent = Column(Boolean, nullable=False, default=False)
    gmail_starred = Column(Boolean, nullable=False, default=False)
    gmail_archived = Column(Boolean, nullable=False, default=False)
    gmail_is_outbound = Column(Boolean, nullable=False, default=False)

    from_name = Column(String, nullable=False)
    from_email = Column(String, nullable=False)
    # Envelope recipients (RFC To/Cc headers). Needed for reply-all so we send
    # to every original participant, and to render the recipients row in the
    # thread UI when Andrea was CC'd.
    to_emails = Column(ARRAY(String), nullable=False, server_default="{}")
    cc_emails = Column(ARRAY(String), nullable=False, server_default="{}")
    subject = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    # Original HTML body when Gmail supplied one (sanitized before render).
    # Preserves formatting for HTML-only marketing-style replies; body stays
    # the plain-text fallback for classifier + preview.
    html_body = Column(Text, nullable=True)
    # Short preview text used in the list-row snippet without loading the body.
    snippet = Column(String, nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=False)

    # RFC 5322 threading headers. Gmail's threadId is enough to thread inside
    # Gmail's own UI; other clients (Outlook, Apple Mail) need Message-Id /
    # In-Reply-To / References set on outbound too, so we persist them here.
    message_id_header = Column(String, nullable=True, index=True)
    in_reply_to_header = Column(String, nullable=True)
    references_header = Column(Text, nullable=True)  # space-separated list

    # Forward metadata. When a colleague forwards a customer email to Andrea
    # the "from" is the colleague, but the reply should default to the
    # original customer. These fields capture that pivot so the UI + composer
    # can address the right person.
    is_forward = Column(Boolean, nullable=False, default=False)
    forwarded_by_name = Column(String, nullable=True)
    forwarded_by_email = Column(String, nullable=True)
    original_from_name = Column(String, nullable=True)
    original_from_email = Column(String, nullable=True)

    # Classifier output
    intent = Column(String, nullable=True)
    intent_confidence = Column(Integer, nullable=True)
    language = Column(String, nullable=True)
    sender_first_name = Column(String, nullable=True)
    urgent = Column(Boolean, nullable=False, default=False)

    # Composer output
    template_used = Column(String, nullable=True)  # template name shown in UI
    template_ids = Column(ARRAY(String), nullable=False, server_default="{}")
    draft_body = Column(Text, nullable=True)
    draft_tweak_level = Column(String, nullable=True)  # verbatim | personalized | merged | fallback
    draft_status = Column(String, nullable=False, default="Processing")
    # Imported | Processing | Draft Created | Flagged | Reviewed | Sent | Ignored

    flagged = Column(Boolean, nullable=False, default=False)
    flag_reason = Column(String, nullable=True)
    read = Column(Boolean, nullable=False, default=False)
    archived = Column(Boolean, nullable=False, default=False)
    # Soft delete (the "Bin"). Rows are only hard-deleted by "empty bin" /
    # "delete forever" actions on the dashboard.
    deleted = Column(Boolean, nullable=False, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    sent_at = Column(DateTime(timezone=True), nullable=True)
    sent_body = Column(Text, nullable=True)
    # Gmail message id + RFC Message-Id of Andrea's outbound send.
    # Recorded on Send so history sync can dedupe when Gmail echoes our own
    # message back through the INBOX/SENT label mirror, and so future replies
    # in this thread can reference her prior send.
    sent_gmail_message_id = Column(String, nullable=True, unique=True)
    sent_message_id_header = Column(String, nullable=True)

    # Eager (selectin) so listing the workspace loads all attachments in a
    # single extra IN query rather than N per-row lazy loads.
    attachments = relationship(
        "EmailAttachment",
        cascade="all, delete-orphan",
        order_by="EmailAttachment.id",
        lazy="selectin",
    )


class EmailAttachment(Base):
    """A file attached to an inbound (or composed) email.

    Attachment *bytes* are not stored inline for real Gmail messages — Gmail
    delivers them behind a separate attachmentId that we fetch on demand at
    download time. We persist only lightweight metadata here plus, for
    mock-mode / testing, an optional inline base64 payload so downloads work
    end-to-end without a live Gmail connection.
    """

    __tablename__ = "email_attachments"

    id = Column(String, primary_key=True)
    email_id = Column(String, ForeignKey("emails.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    mime_type = Column(String, nullable=False, default="application/octet-stream")
    size_bytes = Column(Integer, nullable=False, default=0)
    # Gmail's per-message attachment handle used to fetch bytes on demand (live).
    gmail_attachment_id = Column(Text, nullable=True)
    # Inline bytes (base64) — populated in mock mode / small inline images so
    # the download endpoint can serve without Gmail.
    content_base64 = Column(Text, nullable=True)
    # Inline (cid:) attachments referenced by the HTML body vs. real file
    # attachments shown as chips.
    is_inline = Column(Boolean, nullable=False, default=False)
    content_id = Column(String, nullable=True)


class EmailTemplate(Base):
    """Centrally managed reply template (single source of truth)."""

    __tablename__ = "email_templates"

    id = Column(String, primary_key=True)
    account_email = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    intent = Column(String, nullable=True)  # which classifier intent this answers
    status = Column(String, nullable=False, default="Active")  # Active | Draft | Archived
    archived_from = Column(String, nullable=True)  # Active | Draft — set when moved to Archived
    subject = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    times_used = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False)
    last_updated = Column(DateTime(timezone=True), nullable=False)


class TemplateTranslation(Base):
    """Reviewed language variant of a template (fr, de, es, ja)."""

    __tablename__ = "template_translations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    template_id = Column(String, nullable=False, index=True)
    language = Column(String, nullable=False)  # ISO 639-1
    subject = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    reviewed = Column(Boolean, nullable=False, default=False)


class DraftEdit(Base):
    """Delta between the AI draft and what the admin actually sent.

    Raw learning signal for the distiller. Rows are kept forever for audit;
    only distilled guidance notes ever reach the model's context.
    """

    __tablename__ = "draft_edits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email_id = Column(String, nullable=False, index=True)
    intent = Column(String, nullable=True, index=True)
    template_id = Column(String, nullable=True)
    language = Column(String, nullable=True)
    draft_body = Column(Text, nullable=False)
    final_body = Column(Text, nullable=False)
    diff = Column(Text, nullable=False)
    edit_ratio = Column(Float, nullable=False)  # 0 = sent verbatim, 1 = fully rewritten
    created_at = Column(DateTime(timezone=True), nullable=False)
    distilled = Column(Boolean, nullable=False, default=False)


class GuidanceNote(Base):
    """Distilled, capped drafting rules for one intent.

    The context-size guarantee lives here: the distiller merges new learnings
    into this fixed-size record instead of appending history.
    """

    __tablename__ = "guidance_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    intent = Column(String, nullable=False, unique=True)
    rules = Column(ARRAY(String), nullable=False, server_default="{}")
    version = Column(Integer, nullable=False, default=1)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class TemplateSuggestion(Base):
    """Distiller-proposed template revision or new template, awaiting admin review."""

    __tablename__ = "template_suggestions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    kind = Column(String, nullable=False)  # revision | new
    template_id = Column(String, nullable=True)
    source_email_id = Column(String, nullable=True, index=True)
    account_email = Column(String, nullable=True, index=True)
    intent = Column(String, nullable=True)
    suggested_name = Column(String, nullable=False)
    suggested_subject = Column(String, nullable=False)
    suggested_body = Column(Text, nullable=False)
    rationale = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="pending")  # pending | approved | rejected
    created_at = Column(DateTime(timezone=True), nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)


class ProcessingLog(Base):
    """Audit trail of email pipeline and learning activity."""

    __tablename__ = "processing_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    type = Column(String, nullable=False)
    description = Column(String, nullable=False)
    email_id = Column(String, nullable=True)


class ManagerAllowedDomain(Base):
    """Email domain allowed for manager portal login / signup / submit."""

    __tablename__ = "manager_allowed_domains"
    __table_args__ = (
        UniqueConstraint("partner_id", "domain", name="uq_manager_partner_domain"),
    )

    id = Column(String, primary_key=True)
    partner_id = Column(String, ForeignKey("partners.id"), nullable=True, index=True)
    domain = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)


class AutomatedRosterSource(Base):
    """Sender email or domain allowed to trigger automated add/remove intake."""

    __tablename__ = "automated_roster_sources"
    __table_args__ = (
        UniqueConstraint("partner_id", "kind", "pattern", name="uq_automated_roster_sources_partner_kind_pattern"),
    )

    id = Column(String, primary_key=True)
    partner_id = Column(String, ForeignKey("partners.id"), nullable=True, index=True)
    kind = Column(String, nullable=False)  # email | domain
    pattern = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)


class PartnerCustomForm(Base):
    """Custom manager submission form configuration per partner."""

    __tablename__ = "partner_custom_forms"

    partner_id = Column(String, ForeignKey("partners.id", ondelete="CASCADE"), primary_key=True)
    logo_url = Column(Text, nullable=True)
    logo_data_url = Column(Text, nullable=True)
    fields = Column(JSONB, nullable=False, server_default="[]")
