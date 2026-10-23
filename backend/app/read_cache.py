"""Per-request memo for read-only serialization passes.

Serializing the New Requests page asks the same questions once per row (all
dismissed pairs, a group's members, a person's Directory candidates). Against a
remote Postgres every one of those is a network round trip, so a 19-row page
took ~190 queries. Inside ``read_cache_scope()`` the answers are memoized for
the duration of the pass; outside a scope every helper queries as before.

Only open a scope around code that does not write: memoized answers are not
invalidated.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Any, Callable, Hashable, Iterator, Optional

_store: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar(
    "pm_read_cache", default=None
)

_MISSING = object()


@contextmanager
def read_cache_scope() -> Iterator[None]:
    """Memoize lookups until the outermost scope exits (nested scopes share it)."""
    if _store.get() is not None:
        yield
        return
    token = _store.set({})
    try:
        yield
    finally:
        _store.reset(token)


def is_active() -> bool:
    return _store.get() is not None


def cached(key: Hashable, loader: Callable[[], Any]) -> Any:
    store = _store.get()
    if store is None:
        return loader()
    value = store.get(key, _MISSING)
    if value is _MISSING:
        value = loader()
        store[key] = value
    return value


def seed(key: Hashable, value: Any) -> None:
    store = _store.get()
    if store is not None:
        store[key] = value


def peek(key: Hashable) -> Any:
    store = _store.get()
    if store is None:
        return None
    value = store.get(key, _MISSING)
    return None if value is _MISSING else value
