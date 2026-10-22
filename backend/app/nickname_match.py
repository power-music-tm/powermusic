"""First-name nickname matching via the carltonnorthern/nicknames dataset.

Replaces Jaro-Winkler for the Potential-duplicate `first_match` flag.

Two first names match when they are exact, or linked in the nickname graph
(direct nickname/canonical, or a shared related token of length >= 3 so
generic stubs like "al" do not glue Alex to Alfred).
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import FrozenSet, Optional, Set

# All whitespace (spaces, tabs, newlines) — so "ru bab" / "RuBab" / "RUBAB" align.
_WS = re.compile(r"\s+")

# Ignore ultra-short shared tokens ("al", "jo") — they over-connect unrelated names.
_MIN_SHARED_TOKEN_LEN = 3


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
    return frozenset(related)


def first_names_nickname_match(left: Optional[str], right: Optional[str]) -> bool:
    """True if first names are the same person-name via exact or nickname dataset links."""
    a = _norm_first(left)
    b = _norm_first(right)
    if not a or not b:
        return False
    if a == b:
        return True

    ra = related_first_names(a)
    rb = related_first_names(b)

    # Direct containment (covers alex↔alexander even when the only bridge is short)
    if a in rb or b in ra:
        return True

    shared = ra & rb
    return any(len(token) >= _MIN_SHARED_TOKEN_LEN for token in shared)
