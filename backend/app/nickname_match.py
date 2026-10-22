"""First-name nickname matching via the carltonnorthern/nicknames dataset.

Replaces Jaro-Winkler for the Potential-duplicate `first_match` flag.

Two first names match when they are exact, or linked in the nickname graph
(direct nickname/canonical, or a shared related token of length >= 3 so
generic stubs like "al" do not glue Alex to Alfred).

Admin "Keep Existing and Add New" can learn that two nickname-linked names
are *different* people. Those pairs are stored in `rejected_nickname_pairs`
and suppress graph matches for all future request↔Directory matching
(exact same first name still matches).
"""

from __future__ import annotations

import contextvars
import re
from contextlib import contextmanager
from functools import lru_cache
from typing import FrozenSet, Iterable, Optional, Set, Tuple

# All whitespace (spaces, tabs, newlines) — so "ru bab" / "RuBab" / "RUBAB" align.
_WS = re.compile(r"\s+")

# Ignore ultra-short shared tokens ("al", "jo") — they over-connect unrelated names.
_MIN_SHARED_TOKEN_LEN = 3

# Request-scoped set of ordered (name_a, name_b) pairs learned as "not the same".
_rejected_nickname_pairs_ctx: contextvars.ContextVar[
    Optional[FrozenSet[Tuple[str, str]]]
] = contextvars.ContextVar("rejected_nickname_pairs", default=None)


def normalize_first_name(value: Optional[str]) -> str:
    """Lowercase and remove all spaces for first-name identity compares.

    Capitalization and spacing must not block matches (RUBAB == rubab == \"ru bab\").
    """
    if not value:
        return ""
    return _WS.sub("", str(value).strip().lower())


# Back-compat alias used inside this module.
_norm_first = normalize_first_name


@lru_cache(maxsize=1)
def _extra_nickname_aliases() -> dict[str, FrozenSet[str]]:
    """Spelling/nickname clusters missing from the nicknames package.

    Loaded from app/data/nickname_extras.json (curated from Behind the Name,
    common nickname CSVs, and NickNamer gap analysis).
    """
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parent / "data" / "nickname_extras.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    out: dict[str, FrozenSet[str]] = {}
    if not isinstance(raw, dict):
        return out
    for key, vals in raw.items():
        k = _norm_first(key)
        if not k or not isinstance(vals, list):
            continue
        aliases = frozenset(_norm_first(v) for v in vals if _norm_first(v))
        if aliases:
            out[k] = aliases
    return out


def ordered_nickname_pair(
    left: Optional[str], right: Optional[str]
) -> Optional[Tuple[str, str]]:
    """Normalized unordered pair key, or None if either side is empty."""
    a = _norm_first(left)
    b = _norm_first(right)
    if not a or not b:
        return None
    return (a, b) if a <= b else (b, a)


@contextmanager
def rejected_nickname_pairs_scope(
    pairs: Optional[Iterable[Tuple[str, str]]] = None,
):
    """Apply admin-rejected nickname pairs for the duration of a matching run."""
    frozen: FrozenSet[Tuple[str, str]] = frozenset(pairs or ())
    token = _rejected_nickname_pairs_ctx.set(frozen)
    try:
        yield
    finally:
        _rejected_nickname_pairs_ctx.reset(token)


def _active_rejected_pairs() -> FrozenSet[Tuple[str, str]]:
    return _rejected_nickname_pairs_ctx.get() or frozenset()


def is_nickname_pair_rejected(
    left: Optional[str],
    right: Optional[str],
    *,
    rejected_pairs: Optional[Iterable[Tuple[str, str]]] = None,
) -> bool:
    """True when admin learned these first names are different (nickname-only)."""
    key = ordered_nickname_pair(left, right)
    if not key:
        return False
    if rejected_pairs is not None:
        return key in frozenset(rejected_pairs)
    return key in _active_rejected_pairs()


@lru_cache(maxsize=1)
def _nicknamer():
    from nicknames import NickNamer

    return NickNamer()


@lru_cache(maxsize=8192)
def related_first_names(name: str) -> FrozenSet[str]:
    """Name plus its nicknames and canonicals (one hop)."""
    n = _norm_first(name)
    if not n:
        return frozenset()
    nn = _nicknamer()
    related: Set[str] = {n}
    related |= set(nn.nicknames_of(n) or [])
    related |= set(nn.canonicals_of(n) or [])
    related |= set(_extra_nickname_aliases().get(n) or ())
    return frozenset(related)


def _nickname_graph_related(a: str, b: str) -> bool:
    """True when the dataset links a↔b (assumes both already normalized, a != b)."""
    ra = related_first_names(a)
    rb = related_first_names(b)

    # Direct containment (covers alex↔alexander even when the only bridge is short)
    if a in rb or b in ra:
        return True

    shared = ra & rb
    return any(len(token) >= _MIN_SHARED_TOKEN_LEN for token in shared)


def is_nickname_only_first_match(left: Optional[str], right: Optional[str]) -> bool:
    """True when first names differ after normalize but are nickname-graph related.

    Ignores admin rejected pairs — used to decide whether to show the learning
    confirmation on Keep Existing and Add New.
    """
    a = _norm_first(left)
    b = _norm_first(right)
    if not a or not b or a == b:
        return False
    return _nickname_graph_related(a, b)


def first_names_nickname_match(
    left: Optional[str],
    right: Optional[str],
    *,
    rejected_pairs: Optional[Iterable[Tuple[str, str]]] = None,
) -> bool:
    """True if first names are the same person-name via exact or nickname dataset links.

    Exact matches always win. Nickname-graph matches are suppressed when the pair
    was learned as different (rejected_pairs arg or request-scoped context).
    """
    a = _norm_first(left)
    b = _norm_first(right)
    if not a or not b:
        return False
    if a == b:
        return True

    if is_nickname_pair_rejected(a, b, rejected_pairs=rejected_pairs):
        return False

    return _nickname_graph_related(a, b)
