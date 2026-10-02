"""Supabase Realtime broadcasts.

When mail changes server-side (a Gmail push sync, a poll, or the AI finishing
a draft) we publish a small "workspace changed" event to a Supabase Realtime
channel. The dashboard subscribes to that channel and refetches through the
normal authed API, so the UI updates in ~1s without polling.

Design choices:
- **Broadcast, not postgres_changes.** We don't expose the `emails` table to
  the browser's Supabase client, so a broadcast channel avoids adding RLS +
  a Realtime publication on that table. The payload is only a nudge — never
  email content — so a public channel is fine.
- **Best-effort.** A Realtime hiccup must never break ingestion, so every
  failure is swallowed (the 30s poll remains the fallback).
- **Stdlib only.** Uses urllib so we don't add an HTTP dependency.
"""

import json
import logging
import urllib.parse
import urllib.request

from app.pilot2 import config

logger = logging.getLogger(__name__)

WORKSPACE_CHANGED = "workspace-changed"
REQUESTS_CHANGED = "requests-changed"


def broadcast(event: str = WORKSPACE_CHANGED, payload: dict | None = None) -> None:
    """Publish one event to the configured Realtime channel (best-effort)."""
    if not config.realtime_enabled():
        logger.info(
            "Realtime disabled (SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY "
            "not set) — dashboard will only update on its 30s poll, not instantly."
        )
        return

    topic = urllib.parse.quote(config.REALTIME_CHANNEL, safe="")
    event_name = urllib.parse.quote(event, safe="")
    url = (
        f"{config.SUPABASE_URL}/realtime/v1/api/broadcast/"
        f"{topic}/events/{event_name}?private=true"
    )
    body = json.dumps(payload or {}).encode("utf-8")

    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": config.SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {config.SUPABASE_SERVICE_KEY}",
        },
    )
    try:
        # Short timeout: this runs after a much longer sync, so a couple of
        # seconds is negligible, and we never want it to hang ingestion.
        response = urllib.request.urlopen(request, timeout=3)
        logger.info(
            "Realtime broadcast '%s' -> HTTP %s (channel=%s)",
            event,
            getattr(response, "status", "?"),
            config.REALTIME_CHANNEL,
        )
    except Exception:
        logger.warning("Realtime broadcast failed", exc_info=True)


def workspace_changed(source: str, changes: int = 0) -> None:
    """Convenience: nudge the dashboard that the email workspace changed."""
    broadcast(WORKSPACE_CHANGED, {"source": source, "changes": changes})


def requests_changed(source: str) -> None:
    """Nudge the admin New Requests page that the queue changed."""
    broadcast(REQUESTS_CHANGED, {"source": source})
