"""Thin Gemini wrapper.

All LLM traffic goes through `generate_json` so prompt/response logging,
retries, and the no-API-key fallback live in one place. Callers must always
handle a `None` return by falling back to their deterministic path — the
pipeline must never hard-fail because the model is down.
"""

import json
import logging
import re
import time
from typing import Any, Optional

from app.pilot2 import config

logger = logging.getLogger(__name__)


def fence_untrusted(content: str) -> str:
    """Wrap untrusted, public email content so the model treats it strictly as
    data to analyse — not as instructions. Strips any attempt in the content to
    close the fence early and inject its own directives."""
    safe = (content or "").replace("</untrusted_email>", "").replace("<untrusted_email>", "")
    return f"<untrusted_email>\n{safe}\n</untrusted_email>"

_client = None


def _get_client():
    global _client
    if _client is None and config.GEMINI_API_KEY:
        from google import genai

        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


def llm_available() -> bool:
    return bool(config.GEMINI_API_KEY)


def _extract_json(text: str) -> Optional[dict]:
    """Parse a JSON object from model output, tolerating code fences."""
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    else:
        brace = re.search(r"\{.*\}", text, re.DOTALL)
        if brace:
            text = brace.group(0)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def generate_json(
    model: str,
    system: str,
    prompt: str,
    *,
    response_schema: Optional[dict] = None,
    kind: str = "generate",
) -> Optional[dict[str, Any]]:
    """One structured-output call. Returns None on any failure.

    `response_schema` (a Gemini/OpenAPI schema dict) constrains the model to
    valid, typed JSON — no more parsing prose or silent malformed output.
    Transient errors (overload, rate limit) are retried, then a DIFFERENT backup
    model is tried. Every attempt emits an LLM_TRACE for observability.
    """
    from app.pilot2.ai import observability as obs

    client = _get_client()
    if client is None:
        return None

    backup = config.BACKUP_MODEL
    if not backup or backup == model:
        # Cross-fallback: Gemini quotas are per-model, so a backup only helps
        # if it's a DIFFERENT model. When the configured backup equals the
        # primary (e.g. composer already runs on flash), fall back to the other
        # workhorse alias instead of skipping the fallback entirely.
        backup = "gemini-flash-latest" if "lite" in model else "gemini-flash-lite-latest"
    attempts = [model, model] + ([backup] if backup != model else [])

    call_config: dict[str, Any] = {
        "system_instruction": system,
        "temperature": 0.2,
        "response_mime_type": "application/json",
    }
    if response_schema is not None:
        call_config["response_schema"] = response_schema

    for attempt, attempt_model in enumerate(attempts):
        if attempt > 0:
            time.sleep(1.5 * attempt)
        with obs.timed() as elapsed:
            try:
                response = client.models.generate_content(
                    model=attempt_model, contents=prompt, config=call_config
                )
                inp, out, total = obs.usage_tokens(response)
                obs.record_llm_call(
                    kind=kind, model=attempt_model, latency_ms=elapsed(), status="ok",
                    input_tokens=inp, output_tokens=out, total_tokens=total,
                    fallback_from=model if attempt_model != model else None,
                )
                return _extract_json(response.text or "")
            except Exception as exc:
                obs.record_llm_call(
                    kind=kind, model=attempt_model, latency_ms=elapsed(), status="error",
                    error=exc, fallback_from=model if attempt_model != model else None,
                )
                logger.warning(
                    "Gemini call failed (model=%s, attempt %d/%d)",
                    attempt_model, attempt + 1, len(attempts),
                    exc_info=attempt == len(attempts) - 1,
                )
    return None
