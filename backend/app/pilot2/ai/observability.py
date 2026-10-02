"""Lightweight LLM observability.

Every model call funnels through `record_llm_call`. It always emits one
structured JSON trace line, queryable in the runtime logs by the `LLM_TRACE`
prefix (model, latency, token counts, cost estimate, status, fallbacks). When
`LANGFUSE_PUBLIC_KEY` is set it also best-effort mirrors the trace to Langfuse
for a hosted dashboard. No required dependency; this must never raise into the
pipeline.
"""

from __future__ import annotations

import json
import logging
import os
import time
from contextlib import contextmanager
from typing import Optional

logger = logging.getLogger("pilot2.llm")

# Rough per-million-token USD prices for cost estimates in traces. Approximate
# and easy to update; overridable via env. Cost is a signal, not a bill.
_PRICE_PER_MTOK = {
    "input": float(os.getenv("PILOT2_LLM_PRICE_IN", "0.10")),
    "output": float(os.getenv("PILOT2_LLM_PRICE_OUT", "0.40")),
}


def _estimate_cost(input_tokens: Optional[int], output_tokens: Optional[int]) -> Optional[float]:
    if input_tokens is None and output_tokens is None:
        return None
    cost = (input_tokens or 0) / 1e6 * _PRICE_PER_MTOK["input"] + (
        output_tokens or 0
    ) / 1e6 * _PRICE_PER_MTOK["output"]
    return round(cost, 6)


def record_llm_call(
    *,
    kind: str,
    model: str,
    latency_ms: float,
    status: str,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    total_tokens: Optional[int] = None,
    fallback_from: Optional[str] = None,
    error: Optional[object] = None,
    extra: Optional[dict] = None,
) -> None:
    """Emit one structured trace for a single model call. Never raises."""
    try:
        trace = {
            "evt": "llm_call",
            "kind": kind,  # classify | compose | distill | embed
            "model": model,
            "latency_ms": round(latency_ms),
            "status": status,  # ok | error
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "cost_usd_est": _estimate_cost(input_tokens, output_tokens),
        }
        if fallback_from:
            trace["fallback_from"] = fallback_from
        if error is not None:
            trace["error"] = str(error)[:200]
        if extra:
            trace.update(extra)
        logger.info("LLM_TRACE %s", json.dumps(trace, default=str))
        _maybe_langfuse(trace)
    except Exception:  # observability must never break the pipeline
        logger.debug("record_llm_call failed", exc_info=True)


def _maybe_langfuse(trace: dict) -> None:
    """Best-effort mirror to Langfuse when configured. Silent no-op otherwise."""
    if not os.getenv("LANGFUSE_PUBLIC_KEY"):
        return
    try:
        from langfuse import Langfuse

        client = Langfuse()
        client.trace(
            name=f"pilot2-{trace.get('kind')}",
            metadata=trace,
        )
    except Exception:
        logger.debug("Langfuse mirror failed", exc_info=True)


def usage_tokens(response) -> tuple:
    """Pull (input, output, total) token counts off a google-genai response."""
    um = getattr(response, "usage_metadata", None)
    if um is None:
        return None, None, None
    return (
        getattr(um, "prompt_token_count", None),
        getattr(um, "candidates_token_count", None),
        getattr(um, "total_token_count", None),
    )


@contextmanager
def timed():
    """Yield a callable returning elapsed milliseconds."""
    start = time.monotonic()
    yield lambda: (time.monotonic() - start) * 1000.0
