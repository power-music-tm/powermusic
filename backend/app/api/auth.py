"""Supabase JWT verification and role-based API access control."""

from __future__ import annotations

import functools
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Optional
from urllib.parse import urlparse

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.partner_allowlists import (
    assert_manager_email_allowed,
    get_partner_by_slug,
    partner_slug_from_name,
)

SUPABASE_URL = (
    os.getenv("SUPABASE_URL", "")
    or os.getenv("VITE_SUPABASE_URL", "")
).rstrip("/")
JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
JWT_KEY_ID = os.getenv("SUPABASE_JWT_KEY_ID", "")
JWT_AUDIENCE = "authenticated"
JWKS_ALGORITHMS = ["RS256", "ES256", "EdDSA"]
AUTH_DISABLED = os.getenv("DISABLE_API_AUTH", "").lower() in ("1", "true", "yes")
_AUTH_CACHE: dict[str, tuple[float, AuthenticatedUser]] = {}
_AUTH_CACHE_TTL_SECONDS = 300
_AUTH_CACHE_LOCK = Lock()
_AUTH_CACHE_MAX = 5000


def _ensure_supabase_bypasses_proxy() -> None:
    """Local Cursor/sandbox proxies often block HTTPS CONNECT to Supabase.

    JWKS verification needs a direct fetch; keep localhost + Supabase hosts in
    NO_PROXY so urllib/httpx don't send them through a dying local proxy.
    """
    host = urlparse(SUPABASE_URL).hostname if SUPABASE_URL else None
    extras = ["127.0.0.1", "localhost", "::1"]
    if host:
        extras.extend([host, ".supabase.co"])
    for key in ("NO_PROXY", "no_proxy"):
        existing = [p.strip() for p in os.environ.get(key, "").split(",") if p.strip()]
        merged = list(dict.fromkeys([*existing, *extras]))
        os.environ[key] = ",".join(merged)


_ensure_supabase_bypasses_proxy()


class _DirectPyJWKClient(PyJWKClient):
    """Fetch JWKS without inheriting HTTP(S)_PROXY from the process env."""

    def fetch_data(self):  # type: ignore[override]
        request = urllib.request.Request(self.uri, headers=self.headers)
        handlers: list[urllib.request.BaseHandler] = [urllib.request.ProxyHandler({})]
        if self.ssl_context is not None:
            handlers.append(urllib.request.HTTPSHandler(context=self.ssl_context))
        opener = urllib.request.build_opener(*handlers)
        try:
            with opener.open(request, timeout=self.timeout) as response:
                return json.load(response)
        except (OSError, TimeoutError, urllib.error.HTTPError) as exc:
            raise PyJWKClientConnectionError(
                f'Fail to fetch data from the url, err: "{exc}"'
            ) from exc


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str
    role: str
    partner_id: Optional[str] = None


def auth_is_configured() -> bool:
    return bool(SUPABASE_URL or JWT_SECRET)


def auth_is_required() -> bool:
    """Auth is always enforced in production; locally it can be disabled for dev."""
    if AUTH_DISABLED:
        return False
    if os.getenv("VERCEL") or os.getenv("ENVIRONMENT", "").lower() == "production":
        return True
    return auth_is_configured()


@functools.lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient | None:
    if not SUPABASE_URL:
        return None
    return _DirectPyJWKClient(
        f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
        cache_keys=True,
    )


def _decode_with_jwks(token: str) -> dict:
    client = _jwks_client()
    if client is None:
        raise jwt.PyJWTError("SUPABASE_URL is not configured for JWKS verification")

    signing_key = client.get_signing_key_from_jwt(token)
    if JWT_KEY_ID:
        header = jwt.get_unverified_header(token)
        token_kid = header.get("kid")
        if token_kid and token_kid != JWT_KEY_ID:
            raise jwt.PyJWTError("JWT key id does not match SUPABASE_JWT_KEY_ID")

    issuer = f"{SUPABASE_URL}/auth/v1"
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=JWKS_ALGORITHMS,
        audience=JWT_AUDIENCE,
        issuer=issuer,
    )


def _decode_with_legacy_secret(token: str) -> dict:
    if not JWT_SECRET:
        raise jwt.PyJWTError("SUPABASE_JWT_SECRET is not configured")
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience=JWT_AUDIENCE)


def verify_bearer_token(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    if not auth_is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "API authentication is not configured. Set SUPABASE_URL for JWKS "
                "(recommended) or SUPABASE_JWT_SECRET for legacy HS256 tokens."
            ),
        )

    jwks_error: jwt.PyJWTError | None = None
    if SUPABASE_URL:
        try:
            return _decode_with_jwks(token)
        except jwt.PyJWTError as exc:
            jwks_error = exc

    if JWT_SECRET:
        try:
            return _decode_with_legacy_secret(token)
        except jwt.PyJWTError as exc:
            detail = str(jwks_error or exc)
            raise HTTPException(status_code=401, detail=f"Invalid or expired token: {detail}") from exc

    raise HTTPException(
        status_code=401,
        detail=f"Invalid or expired token: {jwks_error}",
    ) from jwks_error


def _role_from_claims(claims: dict) -> str | None:
    """Legacy helper — role must come from powermusic_users, not JWT metadata."""
    for key in ("app_metadata", "user_metadata"):
        meta = claims.get(key) or {}
        role = meta.get("role")
        if role in ("admin", "manager"):
            return role
    return None


def invalidate_auth_cache(user_id: str | None = None) -> None:
    with _AUTH_CACHE_LOCK:
        if user_id:
            _AUTH_CACHE.pop(user_id, None)
        else:
            _AUTH_CACHE.clear()


def _cache_get(user_id: str) -> AuthenticatedUser | None:
    with _AUTH_CACHE_LOCK:
        entry = _AUTH_CACHE.get(user_id)
        if entry is None:
            return None
        cached_at, user = entry
        if time.time() - cached_at > _AUTH_CACHE_TTL_SECONDS:
            _AUTH_CACHE.pop(user_id, None)
            return None
        return user


def _cache_set(user_id: str, user: AuthenticatedUser) -> None:
    with _AUTH_CACHE_LOCK:
        if len(_AUTH_CACHE) >= _AUTH_CACHE_MAX:
            _AUTH_CACHE.clear()
        _AUTH_CACHE[user_id] = (time.time(), user)


def get_authenticated_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    if not auth_is_required():
        return AuthenticatedUser(id="dev-bypass", email="dev@local", role="admin")

    claims = verify_bearer_token(authorization)
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    cached = _cache_get(user_id)
    if cached is not None:
        return cached

    profile = db.query(models.Profile).filter(models.Profile.id == user_id).first()
    if profile is None:
        user_meta = claims.get("user_metadata") or {}
        role = user_meta.get("role") or "manager"
        if role == "manager":
            meta_first = (user_meta.get("firstName") or "").strip() or None
            meta_last = (user_meta.get("lastName") or "").strip() or None
            meta_full = (user_meta.get("full_name") or "").strip() or None
            if not meta_full and (meta_first or meta_last):
                meta_full = f"{meta_first or ''} {meta_last or ''}".strip() or None
            meta_club = (user_meta.get("club") or "").strip() or None
            partner_slug = user_meta.get("partner_slug") or user_meta.get("partnerSlug")
            meta_partner_id = user_meta.get("partner_id") or user_meta.get("partnerId")

            p_id = None
            if meta_partner_id:
                p_match = db.query(models.Partner).filter(models.Partner.id == meta_partner_id).first()
                if p_match:
                    p_id = p_match.id
            if not p_id and partner_slug:
                p_match = get_partner_by_slug(db, partner_slug)
                if p_match:
                    p_id = p_match.id

            user_email = claims.get("email") or ""
            if p_id and user_email:
                try:
                    assert_manager_email_allowed(db, user_email, partner_id=p_id)
                except Exception:
                    p_id = None

            profile = models.Profile(
                id=uuid.UUID(str(user_id)),
                email=user_email,
                full_name=meta_full or (user_email.split("@")[0] if user_email else None),
                first_name=meta_first,
                last_name=meta_last,
                club=meta_club,
                role="manager",
                partner_id=p_id,
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)
        else:
            raise HTTPException(status_code=403, detail="User profile not found")

    if profile.role == "manager" and not profile.partner_id:
        user_meta = claims.get("user_metadata") or {}
        partner_slug = user_meta.get("partner_slug") or user_meta.get("partnerSlug")
        meta_partner_id = user_meta.get("partner_id") or user_meta.get("partnerId")
        p_id = None
        if meta_partner_id:
            p_match = db.query(models.Partner).filter(models.Partner.id == meta_partner_id).first()
            if p_match:
                p_id = p_match.id
        if not p_id and partner_slug:
            p_match = get_partner_by_slug(db, partner_slug)
            if p_match:
                p_id = p_match.id

        user_email = profile.email or (claims.get("email") or "")
        if p_id and user_email:
            try:
                assert_manager_email_allowed(db, user_email, partner_id=p_id)
                profile.partner_id = p_id
                db.commit()
                db.refresh(profile)
            except Exception:
                pass

        if not profile.partner_id:
            recent_req = (
                db.query(models.ManagerRequest)
                .filter(
                    models.ManagerRequest.manager_id == profile.id,
                    models.ManagerRequest.partner_id.isnot(None),
                )
                .order_by(models.ManagerRequest.received_at.desc())
                .first()
            )
            if recent_req and recent_req.partner_id:
                profile.partner_id = recent_req.partner_id
                db.commit()
                db.refresh(profile)

    user = AuthenticatedUser(
        id=str(profile.id),
        email=profile.email or (claims.get("email") or ""),
        role=profile.role,
        partner_id=getattr(profile, "partner_id", None),
    )
    _cache_set(user_id, user)
    return user


auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


@auth_router.get("/me")
def get_current_profile(
    user: AuthenticatedUser = Depends(get_authenticated_user),
    db: Session = Depends(get_db),
):
    profile = db.query(models.Profile).filter(models.Profile.id == user.id).first()
    if profile is None:
        raise HTTPException(status_code=403, detail="User profile not found")

    partner_name = None
    partner_slug = None
    if profile.partner_id:
        partner = db.query(models.Partner).filter(models.Partner.id == profile.partner_id).first()
        if partner:
            partner_name = partner.name
            partner_slug = partner_slug_from_name(partner.name)

    return {
        "id": str(profile.id),
        "email": profile.email or user.email,
        "full_name": profile.full_name,
        "first_name": profile.first_name,
        "last_name": profile.last_name,
        "club": profile.club,
        "role": profile.role,
        "partner_id": getattr(profile, "partner_id", None),
        "partner_name": partner_name,
        "partner_slug": partner_slug,
    }


def require_admin(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> AuthenticatedUser:
    if auth_is_required() and user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_manager(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> AuthenticatedUser:
    if not auth_is_required():
        return user
    if user.role != "manager":
        raise HTTPException(status_code=403, detail="Manager access required")
    return user
