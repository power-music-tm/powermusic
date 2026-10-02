"""Self-contained HTML pages for the Gmail OAuth callback flow."""

from html import escape
import re

from app.pilot2 import config

_BASE_STYLES = """
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    min-height: 100%;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: #f8f9fb;
    color: #1a1a2e;
    -webkit-font-smoothing: antialiased;
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 20px;
    min-height: 100vh;
  }
  .shell {
    width: 100%;
    max-width: 400px;
  }
  .card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(26,26,46,0.06);
    overflow: hidden;
  }
  .card-top {
    padding: 32px 32px 0;
    text-align: center;
    border-bottom: 1px solid #f3f4f6;
  }
  .brand-logo {
    display: block;
    height: 72px;
    width: auto;
    margin: 0 auto;
    object-fit: contain;
  }
  .card-main {
    padding: 28px 32px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    margin-bottom: 24px;
  }
  .status-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    flex-shrink: 0;
  }
  .status-icon svg { width: 24px; height: 24px; }
  .status-icon.success {
    background: #ecfdf5;
    color: #059669;
    border: 1px solid #a7f3d0;
  }
  .status-icon.error {
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
  }
  .status-title {
    font-size: 18px;
    font-weight: 700;
    line-height: 1.35;
    letter-spacing: -0.01em;
    color: #1a1a2e;
    margin-bottom: 6px;
  }
  .status-text {
    font-size: 13px;
    line-height: 1.55;
    color: #6b7280;
    max-width: 300px;
  }
  .panel {
    width: 100%;
    text-align: left;
    margin-bottom: 20px;
  }
  .inbox-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: #f7f8fc;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
  }
  .inbox-row-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: #fff;
    border: 1px solid #e5e7eb;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #1a1a2e;
  }
  .inbox-row-icon svg { width: 18px; height: 18px; }
  .inbox-row-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #9ca3af;
    margin-bottom: 2px;
  }
  .inbox-row-title {
    font-size: 13px;
    font-weight: 600;
    color: #1a1a2e;
    line-height: 1.3;
  }
  .inbox-row-email {
    font-size: 12px;
    color: #6b7280;
    margin-top: 1px;
    word-break: break-all;
  }
  .callout {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 11px 13px;
    border-radius: 10px;
    font-size: 12px;
    line-height: 1.5;
    text-align: left;
  }
  .callout svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .callout.info {
    background: #f7f8fc;
    border: 1px solid #e5e7eb;
    color: #4b5563;
  }
  .callout.warn {
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
  }
  .help-steps {
    width: 100%;
    text-align: left;
    margin-bottom: 20px;
    padding: 14px 16px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
  }
  .help-steps-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #9ca3af;
    margin-bottom: 10px;
  }
  .help-steps ol {
    margin: 0;
    padding-left: 18px;
    font-size: 12px;
    line-height: 1.6;
    color: #4b5563;
  }
  .help-steps li + li { margin-top: 6px; }
  .actions {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    border: none;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .btn-primary {
    background: #1a1a2e;
    color: #fff;
  }
  .btn-primary:hover { background: #252542; }
  .btn-secondary {
    background: #fff;
    color: #4b5563;
    border: 1px solid #e5e7eb;
  }
  .btn-secondary:hover {
    background: #f9fafb;
    color: #1a1a2e;
  }
  .footnote {
    margin-top: 16px;
    font-size: 11px;
    line-height: 1.45;
    color: #9ca3af;
    max-width: 280px;
  }
"""


def _page(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{escape(title)} · Power Music</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>{_BASE_STYLES}</style>
</head>
<body>
  <div class="shell">
{body}
  </div>
</body>
</html>"""


_CHECK_SVG = """<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>"""

_ERROR_SVG = """<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>"""

_MAIL_SVG = """<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>"""

_SYNC_SVG = """<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>"""


def _logo_url() -> str:
    return f"{config.FRONTEND_URL.rstrip('/')}/image.png"


def _dashboard_url() -> str:
    return f"{config.FRONTEND_URL.rstrip('/')}/email-accounts"


def _friendly_error(message: str) -> tuple[str, str | None]:
    """Return (user-facing copy, optional technical detail)."""
    lower = message.lower()
    if "invalid_grant" in lower:
        return (
            "The Google sign-in link has expired or was already used. "
            "This often happens if you refresh the page or open an old tab.",
            message,
        )
    if "mismatch" in lower or "does not match" in lower:
        return (
            "The Gmail account you signed in with doesn't match the inbox "
            "you selected in the dashboard.",
            message,
        )
    if "access_denied" in lower:
        return ("Google access was declined. Try connecting again and approve the permissions.", message)
    # Strip noisy parenthetical prefixes for the summary line.
    summary = re.sub(r"^\([^)]+\)\s*", "", message).strip() or message
    if summary == message and len(message) > 120:
        return ("Something went wrong while connecting to Gmail. Please try again.", message)
    return (summary, message if summary != message else None)


def oauth_success_page(*, email: str, title: str) -> str:
    safe_email = escape(email)
    safe_title = escape(title)
    body = f"""
    <main class="card" role="main">
      <div class="card-top">
        <img class="brand-logo" src="{escape(_logo_url())}" alt="Power Music" />
      </div>
      <div class="card-main">
        <div class="status">
          <div class="status-icon success" aria-hidden="true">{_CHECK_SVG}</div>
          <h1 class="status-title">Inbox connected</h1>
          <p class="status-text">Email is linked. Your mail will sync in the background.</p>
        </div>

        <div class="panel">
          <div class="inbox-row">
            <div class="inbox-row-icon" aria-hidden="true">{_MAIL_SVG}</div>
            <div>
              <div class="inbox-row-label">Connected inbox</div>
              <div class="inbox-row-title">{safe_title}</div>
              <div class="inbox-row-email">{safe_email}</div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="callout info" role="status">
            {_SYNC_SVG}
            <span>Importing the last {config.BACKFILL_DAYS} days. New messages will appear in Email Queue over the next few minutes.</span>
          </div>
        </div>

        <div class="actions">
          <a class="btn btn-primary" href="{escape(_dashboard_url())}">Return to Email accounts</a>
          <button type="button" class="btn btn-secondary" onclick="window.close()">Close this tab</button>
        </div>

        <p class="footnote">You can close this window once you're back in the dashboard.</p>
      </div>
    </main>
"""
    return _page("Inbox connected", body)


def oauth_error_page(*, message: str) -> str:
    friendly, _detail = _friendly_error(message)
    safe_friendly = escape(friendly)
    body = f"""
    <main class="card" role="main">
      <div class="card-top">
        <img class="brand-logo" src="{escape(_logo_url())}" alt="Power Music" />
      </div>
      <div class="card-main">
        <div class="status">
          <div class="status-icon error" aria-hidden="true">{_ERROR_SVG}</div>
          <h1 class="status-title">Couldn't connect inbox</h1>
          <p class="status-text">{safe_friendly}</p>
        </div>

        <div class="help-steps">
          <div class="help-steps-title">What to do next</div>
          <ol>
            <li>Close this tab</li>
            <li>Go back to Email accounts in the dashboard</li>
            <li>Click <strong>Connect</strong> again and complete Google sign-in in one go</li>
          </ol>
        </div>

        <div class="actions">
          <a class="btn btn-primary" href="{escape(_dashboard_url())}">Back to Email accounts</a>
          <button type="button" class="btn btn-secondary" onclick="window.close()">Close this tab</button>
        </div>
      </div>
    </main>
"""
    return _page("Connection failed", body)
