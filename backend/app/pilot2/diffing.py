"""Deterministic draft-vs-sent comparison. No LLM involved — the diff is
captured for free at Send time and interpreted later by the distiller."""

import difflib


def unified_diff(draft: str, final: str) -> str:
    return "\n".join(
        difflib.unified_diff(
            draft.splitlines(),
            final.splitlines(),
            fromfile="ai_draft",
            tofile="admin_sent",
            lineterm="",
        )
    )


def edit_ratio(draft: str, final: str) -> float:
    """0.0 = sent verbatim, 1.0 = fully rewritten."""
    if not draft and not final:
        return 0.0
    return round(1.0 - difflib.SequenceMatcher(None, draft, final).ratio(), 4)
