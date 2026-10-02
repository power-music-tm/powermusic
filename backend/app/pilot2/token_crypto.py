"""Encrypt Gmail OAuth refresh tokens at rest.

A refresh token is a long-lived key to a user's entire mailbox, so it must not
sit in the database as plain text. We encrypt with Fernet (AES-128-CBC + HMAC)
using a key from the TOKEN_ENCRYPTION_KEY env var.

Generate a key once with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
and set it as TOKEN_ENCRYPTION_KEY in the environment (Vercel + local .env).

Backward compatible: tokens written before encryption was added are stored as
plain text. `decrypt_token` returns those unchanged (they lack our prefix), and
they are re-stored encrypted on the next write (reconnect issues a fresh token).
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

# Marks a value this module encrypted, so decrypt_token can tell an encrypted
# token from a legacy plaintext one unambiguously.
_PREFIX = "enc:v1:"

_warned_no_key = False


def _fernet():
    key = os.getenv("TOKEN_ENCRYPTION_KEY", "")
    if not key:
        return None
    from cryptography.fernet import Fernet

    return Fernet(key.encode("ascii") if isinstance(key, str) else key)


def is_configured() -> bool:
    """True when a TOKEN_ENCRYPTION_KEY is set (encryption is active)."""
    return bool(os.getenv("TOKEN_ENCRYPTION_KEY", ""))


def encrypt_token(plaintext: str | None) -> str | None:
    """Encrypt a token for storage. Returns the value unchanged (with a one-time
    warning) when no key is configured, so dev/mock keeps working."""
    global _warned_no_key
    if not plaintext:
        return plaintext
    f = _fernet()
    if f is None:
        if not _warned_no_key:
            logger.warning(
                "TOKEN_ENCRYPTION_KEY is not set — storing OAuth refresh token "
                "UNENCRYPTED. Set TOKEN_ENCRYPTION_KEY to encrypt tokens at rest."
            )
            _warned_no_key = True
        return plaintext
    return _PREFIX + f.encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_token(stored: str | None) -> str | None:
    """Decrypt a stored token. Legacy plaintext (no prefix) is returned as-is."""
    if not stored or not stored.startswith(_PREFIX):
        return stored
    f = _fernet()
    if f is None:
        raise RuntimeError(
            "An encrypted OAuth token was found but TOKEN_ENCRYPTION_KEY is not "
            "set. Restore the key that was used to encrypt it."
        )
    raw = stored[len(_PREFIX):]
    return f.decrypt(raw.encode("ascii")).decode("utf-8")
