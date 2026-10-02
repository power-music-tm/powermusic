"""Semantic template matching via Gemini embeddings + pgvector.

Matching an email to a reply template used to depend on the LLM guessing an
`intent` label and that label matching the template's — brittle, and it broke
whenever generation was rate-limited. Embeddings fix this: we compare the
*meaning* of the email to the *meaning* of each template. Embeddings are cheap
and barely rate-limited, so matching stays reliable even when generation is not.

Templates carry a stored `embedding` (pgvector column); an incoming email is
embedded on the fly and we return the nearest templates by cosine distance.
Every function degrades to a safe empty/None result on any failure so the
pipeline never hard-fails because of the model.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.pilot2 import config
from app.pilot2.ai.client import _get_client

logger = logging.getLogger(__name__)


def embed_text(value: str) -> Optional[List[float]]:
    """Return a config.EMBEDDING_DIM-length embedding for `value`, or None when
    there is no API key, the text is empty, or the call fails."""
    client = _get_client()
    if client is None or not (value or "").strip():
        return None
    from app.pilot2.ai import observability as obs

    with obs.timed() as elapsed:
        try:
            from google.genai import types

            response = client.models.embed_content(
                model=config.EMBEDDING_MODEL,
                contents=value[:8000],
                config=types.EmbedContentConfig(output_dimensionality=config.EMBEDDING_DIM),
            )
            obs.record_llm_call(
                kind="embed", model=config.EMBEDDING_MODEL, latency_ms=elapsed(), status="ok",
            )
            return list(response.embeddings[0].values)
        except Exception as exc:
            obs.record_llm_call(
                kind="embed", model=config.EMBEDDING_MODEL, latency_ms=elapsed(),
                status="error", error=exc,
            )
            logger.warning("Embedding failed", exc_info=True)
            return None


def to_pgvector_literal(values: List[float]) -> str:
    """Format a float list as a pgvector text literal: [0.1,0.2,...]."""
    return "[" + ",".join(f"{x:.7f}" for x in values) + "]"


def template_embedding_text(name: str, subject: str, category: str, body: str) -> str:
    """The text we embed to represent a template's meaning."""
    parts = [p for p in (name, subject, category, body) if p]
    return "\n".join(parts)


def store_template_embedding(db: Session, template_id: str, embedding: List[float]) -> None:
    """Persist a template's embedding (raw SQL — the vector column is not on the
    ORM model)."""
    db.execute(
        text("UPDATE email_templates SET embedding = CAST(:vec AS vector) WHERE id = :id"),
        {"vec": to_pgvector_literal(embedding), "id": template_id},
    )


def embed_and_store_template(db: Session, template) -> bool:
    """Compute + store the embedding for one template row. Returns True on success."""
    vector = embed_text(
        template_embedding_text(
            template.name or "",
            template.subject or "",
            getattr(template, "category", "") or "",
            template.body or "",
        )
    )
    if vector is None:
        return False
    store_template_embedding(db, template.id, vector)
    return True


def semantic_match_template_ids(
    db: Session,
    account_email: str,
    subject: str,
    body: str,
    *,
    limit: int = 1,
) -> Optional[List[str]]:
    """Ids of the Active templates whose meaning best fits the email, requiring
    a clear winner (see EMBEDDING_MAX_DISTANCE / EMBEDDING_MIN_GAP).

    Returns:
      - None  → embeddings unavailable (caller should use a fallback matcher).
      - []    → embeddings ran, but no template genuinely fits (holding reply).
      - [ids] → the matched template(s).
    The None-vs-[] distinction is important: when embeddings work, an empty
    result is authoritative and must NOT fall through to a looser matcher that
    would let a generic template absorb a poorly-fitting email."""
    vector = embed_text(f"{subject}\n{body}")
    if vector is None:
        return None
    try:
        # Fetch one extra so we can measure the gap to the runner-up.
        rows = db.execute(
            text(
                """
                SELECT id, embedding <=> CAST(:vec AS vector) AS distance
                FROM email_templates
                WHERE account_email = :acc
                  AND status = 'Active'
                  AND embedding IS NOT NULL
                ORDER BY distance ASC
                LIMIT :lim
                """
            ),
            {"vec": to_pgvector_literal(vector), "acc": account_email, "lim": limit + 1},
        ).fetchall()
    except Exception:
        logger.warning("Semantic template search failed", exc_info=True)
        return None

    if not rows or rows[0][1] is None or rows[0][1] > config.EMBEDDING_MAX_DISTANCE:
        return []
    # Require a clear winner: if the runner-up is nearly as close, the templates
    # are clustered and none genuinely fits — treat it as no match.
    if len(rows) > 1 and rows[1][1] is not None and (rows[1][1] - rows[0][1]) < config.EMBEDDING_MIN_GAP:
        return []
    return [
        row[0]
        for row in rows[:limit]
        if row[1] is not None and row[1] <= config.EMBEDDING_MAX_DISTANCE
    ]
