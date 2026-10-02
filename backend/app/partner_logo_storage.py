"""Partner logo object storage via Supabase Storage.

Instagram-style: cropped image bytes live in object storage; Postgres stores a
public HTTPS URL only. Legacy rows may still have inline base64 in logo_data_url
until lazy-migrated on read.
"""

from __future__ import annotations

import base64
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

from app.pilot2 import config

logger = logging.getLogger(__name__)

BUCKET = "partner-logos"
MAX_LOGO_BYTES = 2 * 1024 * 1024
_DATA_URL_RE = re.compile(r"^data:(image/[\w.+-]+);base64,(.+)$", re.DOTALL)


def storage_enabled() -> bool:
    return bool(config.SUPABASE_URL and config.SUPABASE_SERVICE_KEY)


def _safe_partner_id(partner_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", partner_id or "")
    if not safe:
        raise ValueError("Invalid partner id")
    return safe


def object_path(partner_id: str) -> str:
    return f"{_safe_partner_id(partner_id)}/avatar.png"


def public_logo_url(partner_id: str, *, version: Optional[str] = None) -> str:
    path = urllib.parse.quote(object_path(partner_id), safe="/")
    url = f"{config.SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}"
    if version:
        url = f"{url}?v={urllib.parse.quote(version, safe='')}"
    return url


def resolve_partner_logo(form) -> Optional[str]:
    """Preferred logo src for API responses (URL first, legacy data URL fallback)."""
    if not form:
        return None
    logo_url = getattr(form, "logo_url", None)
    if logo_url:
        return logo_url
    return getattr(form, "logo_data_url", None)


def decode_data_url(data_url: str) -> tuple[bytes, str]:
    match = _DATA_URL_RE.match((data_url or "").strip())
    if not match:
        raise ValueError("Invalid image data URL")
    content_type = match.group(1)
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except Exception as exc:
        raise ValueError("Could not decode image data") from exc
    if len(content) > MAX_LOGO_BYTES:
        raise ValueError("Logo exceeds 2MB limit")
    return content, content_type


def upload_partner_logo_bytes(
    partner_id: str,
    content: bytes,
    *,
    content_type: str = "image/png",
) -> str:
    if not storage_enabled():
        raise RuntimeError("Supabase Storage is not configured")
    if len(content) > MAX_LOGO_BYTES:
        raise ValueError("Logo exceeds 2MB limit")

    path = urllib.parse.quote(object_path(partner_id), safe="/")
    url = f"{config.SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}"
    request = urllib.request.Request(
        url,
        data=content,
        method="POST",
        headers={
            "Authorization": f"Bearer {config.SUPABASE_SERVICE_KEY}",
            "apikey": config.SUPABASE_SERVICE_KEY,
            "Content-Type": content_type,
            "x-upsert": "true",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status >= 400:
                raise RuntimeError(f"Storage upload failed ({response.status})")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        logger.warning("Partner logo upload failed (%s): %s", exc.code, body[:300])
        raise RuntimeError("Could not upload logo") from exc
    except urllib.error.URLError as exc:
        logger.warning("Partner logo upload unreachable: %s", exc)
        raise RuntimeError("Could not reach storage") from exc

    return public_logo_url(partner_id, version=str(int(time.time())))


def upload_partner_logo_from_data_url(partner_id: str, data_url: str) -> str:
    content, content_type = decode_data_url(data_url)
    return upload_partner_logo_bytes(partner_id, content, content_type=content_type)


def delete_partner_logo(partner_id: str) -> None:
    if not storage_enabled():
        return

    path = urllib.parse.quote(object_path(partner_id), safe="/")
    url = f"{config.SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}"
    request = urllib.request.Request(
        url,
        method="DELETE",
        headers={
            "Authorization": f"Bearer {config.SUPABASE_SERVICE_KEY}",
            "apikey": config.SUPABASE_SERVICE_KEY,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status >= 400 and response.status != 404:
                raise RuntimeError(f"Storage delete failed ({response.status})")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return
        logger.warning("Partner logo delete failed (%s)", exc.code)
    except urllib.error.URLError as exc:
        logger.warning("Partner logo delete unreachable: %s", exc)


def migrate_inline_logo_to_storage(db, form) -> Optional[str]:
    """Move legacy base64 logo into object storage when possible."""
    if not form:
        return None
    if form.logo_url:
        return form.logo_url
    if not form.logo_data_url or not storage_enabled():
        return form.logo_data_url

    try:
        url = upload_partner_logo_from_data_url(form.partner_id, form.logo_data_url)
        form.logo_url = url
        form.logo_data_url = None
        db.add(form)
        db.commit()
        db.refresh(form)
        return url
    except Exception:
        logger.exception("Lazy logo migration failed for partner %s", form.partner_id)
        db.rollback()
        return form.logo_data_url
