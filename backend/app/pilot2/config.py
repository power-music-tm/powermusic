"""Environment-driven configuration for Pilot 2."""

import os

from dotenv import load_dotenv

from app.pilot2.signature import build_signature

load_dotenv()

# AI
# Use the stable "-latest" aliases: pinned versions (e.g. gemini-2.5-flash) get
# retired and start returning 404, silently dropping the whole pipeline to the
# keyword heuristic. The aliases always resolve to a current model. Override per
# env if a specific pinned version is ever required.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
# Cheap, fast model for the high-volume classification call.
CLASSIFIER_MODEL = os.getenv("PILOT2_CLASSIFIER_MODEL", "gemini-flash-lite-latest")
# Composer runs on every email too; flash is the quality/speed balance.
COMPOSER_MODEL = os.getenv("PILOT2_COMPOSER_MODEL", "gemini-flash-latest")
# Distiller runs once a day on a batch, so a stronger model is affordable.
DISTILLER_MODEL = os.getenv("PILOT2_DISTILLER_MODEL", "gemini-flash-latest")
# Tried when the primary model is overloaded or rate-limited. Must be a
# DIFFERENT model from the primary — quotas are per-model, so falling back to
# the same model just re-hits the same 429.
BACKUP_MODEL = os.getenv("PILOT2_BACKUP_MODEL", "gemini-flash-latest")

# Mark an email urgent when the sender has sent at least this many messages on
# the same thread (chasing us for a reply), regardless of the AI's tone read.
URGENT_FOLLOWUP_THRESHOLD = int(os.getenv("PILOT2_URGENT_FOLLOWUP_THRESHOLD", "3"))

# Semantic template matching (embeddings + pgvector). Matches an email to
# templates by meaning, so matching no longer depends on the template `intent`
# label or a live generation call (embeddings are cheap and rarely throttled).
EMBEDDING_MODEL = os.getenv("PILOT2_EMBEDDING_MODEL", "gemini-embedding-001")
EMBEDDING_DIM = int(os.getenv("PILOT2_EMBEDDING_DIM", "768"))
# A template match must be a CLEAR winner, not just the least-bad of a cluster:
# - best distance must be within EMBEDDING_MAX_DISTANCE (absolute ceiling), AND
# - it must beat the runner-up by at least EMBEDDING_MIN_GAP.
# Measured separation: real matches sit ~0.27-0.39 with a >0.1 gap; "nothing
# fits" cases cluster ~0.42-0.49 with a ~0.01 gap. Otherwise -> no match
# (holding reply + template suggestion).
EMBEDDING_MAX_DISTANCE = float(os.getenv("PILOT2_EMBEDDING_MAX_DISTANCE", "0.55"))
EMBEDDING_MIN_GAP = float(os.getenv("PILOT2_EMBEDDING_MIN_GAP", "0.06"))

# Learning loop bounds — these guarantee a flat context size forever.
MAX_RULES_PER_INTENT = int(os.getenv("PILOT2_MAX_RULES_PER_INTENT", "10"))
MAX_RULE_CHARS = int(os.getenv("PILOT2_MAX_RULE_CHARS", "200"))
DISTILL_BATCH_SIZE = int(os.getenv("PILOT2_DISTILL_BATCH_SIZE", "50"))
# Same-template edits needed before the distiller proposes a template revision.
SUGGESTION_MIN_EDITS = int(os.getenv("PILOT2_SUGGESTION_MIN_EDITS", "3"))

# Gmail integration: "mock" (no Google calls; drafts/sends are recorded
# locally) or "live" (real Gmail API via OAuth).
GMAIL_MODE = os.getenv("PILOT2_GMAIL_MODE", "mock")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv(
    "GOOGLE_REDIRECT_URI", "http://localhost:8000/api/pilot2/inboxes/oauth/callback"
)
FRONTEND_URL = os.getenv("PILOT2_FRONTEND_URL", "http://localhost:5173")
MAX_CONNECTED_INBOXES = int(os.getenv("PILOT2_MAX_CONNECTED_INBOXES", "7"))

# Shared secret for the poll/distill trigger endpoints. When set, callers
# must send it (X-Cron-Secret header, Authorization: Bearer, or ?secret=).
# Leave empty in local dev to keep the endpoints open.
CRON_SECRET = os.getenv("PILOT2_CRON_SECRET") or os.getenv("CRON_SECRET") or ""

# Background jobs — disabled on Vercel by default (use cron + PILOT2_CRON_SECRET).
POLL_INTERVAL_SECONDS = int(os.getenv("PILOT2_POLL_INTERVAL_SECONDS", "15"))
POLL_INTERVAL_MINUTES = int(os.getenv("PILOT2_POLL_INTERVAL_MINUTES", "1"))
DISTILL_HOUR_UTC = int(os.getenv("PILOT2_DISTILL_HOUR_UTC", "2"))
_default_scheduler = "false" if os.getenv("VERCEL") else "true"
SCHEDULER_ENABLED = os.getenv("PILOT2_SCHEDULER_ENABLED", _default_scheduler).lower() == "true"

# Gmail push notifications (Pub/Sub). When a topic is configured and mode is
# live, connecting an inbox arms a Gmail `watch` that publishes change
# notifications to this topic; Google forwards them to the /gmail/push webhook,
# which syncs that inbox in ~1s instead of waiting for the next poll.
#   PILOT2_GMAIL_PUBSUB_TOPIC: projects/<project>/topics/<topic>
#   PILOT2_GMAIL_PUSH_TOKEN:  shared secret appended to the push URL (?token=)
# A Gmail watch lasts 7 days, so it is re-armed daily by the scheduler / cron.
GMAIL_PUBSUB_TOPIC = os.getenv("PILOT2_GMAIL_PUBSUB_TOPIC", "")
GMAIL_PUSH_TOKEN = os.getenv("PILOT2_GMAIL_PUSH_TOKEN", "")
WATCH_RENEW_HOUR_UTC = int(os.getenv("PILOT2_WATCH_RENEW_HOUR_UTC", "3"))


def gmail_push_enabled() -> bool:
    """Push is active only in live mode with a configured Pub/Sub topic."""
    return GMAIL_MODE == "live" and bool(GMAIL_PUBSUB_TOPIC)


# Supabase Realtime — when new mail lands server-side we broadcast a tiny
# "workspace changed" nudge on a channel; the dashboard listens and refetches
# through the authed API instantly (instead of the 30s poll). No email content
# ever travels over the channel — it's just a signal to refresh.
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_SERVICE_KEY", "")
)
REALTIME_CHANNEL = os.getenv("PILOT2_REALTIME_CHANNEL", "pilot2-workspace")


def realtime_enabled() -> bool:
    """Realtime broadcasts are best-effort and only sent when configured."""
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)

# Serverless (Vercel) has no reliable long-lived process, so the initial
# backfill runs synchronously within a time budget inside the OAuth callback
# instead of a background thread that the platform would freeze/kill.
SERVERLESS = bool(os.getenv("VERCEL"))
BACKFILL_TIME_BUDGET_SECONDS = int(os.getenv("PILOT2_BACKFILL_TIME_BUDGET_SECONDS", "20"))

# Gmail sync — initial backfill window and pacing.
BACKFILL_DAYS = int(os.getenv("PILOT2_BACKFILL_DAYS", "10"))
BACKFILL_MAX_MESSAGES_PER_QUERY = int(os.getenv("PILOT2_BACKFILL_MAX_MESSAGES", "500"))
GMAIL_API_PAUSE_SECONDS = float(os.getenv("PILOT2_GMAIL_API_PAUSE", "0.08"))
AI_BATCH_SIZE = int(os.getenv("PILOT2_AI_BATCH_SIZE", "5"))
AI_JOB_INTERVAL_SECONDS = int(os.getenv("PILOT2_AI_JOB_INTERVAL_SECONDS", "15"))
# Time budget for AI processing inside the push webhook, so ingest stays fast
# and the request never approaches the serverless timeout. Leftover queued mail
# drains on the next push/poll.
AI_BATCH_TIME_BUDGET_SECONDS = int(os.getenv("PILOT2_AI_BATCH_TIME_BUDGET_SECONDS", "40"))

SIGNATURE = os.getenv("PILOT2_SIGNATURE", build_signature("Power Music"))

INTENTS = ["Enquiry", "Cancellation", "Renewal", "Partnership", "Finance", "Events"]
SUPPORTED_LANGUAGES = ["en", "fr", "de", "es", "ja"]
