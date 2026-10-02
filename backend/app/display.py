from collections import defaultdict
from datetime import datetime, timezone
from typing import Iterable, TypeVar

T = TypeVar("T")


def _sort_key(value: datetime | None) -> datetime:
    if value is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def assign_display_ids(
    items: Iterable[T],
    *,
    status_attr: str,
    date_attr: str,
) -> list[T]:
    grouped: dict[str, list[T]] = defaultdict(list)
    materialized = list(items)

    for item in materialized:
        grouped[getattr(item, status_attr)].append(item)

    for group in grouped.values():
        group.sort(key=lambda item: _sort_key(getattr(item, date_attr)), reverse=True)
        for index, item in enumerate(group, start=1):
            setattr(item, "displayId", index)

    return materialized
