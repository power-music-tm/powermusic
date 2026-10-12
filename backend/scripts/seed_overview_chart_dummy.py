#!/usr/bin/env python3
"""TEMPORARY Pure Gym dummy rows so Overview Request flow shows bars.

Marker: manager_notes start with "SEED: overview chart dummy"
Ids: dummy-chart-*

Dates stay inside the UI filter window: 1 Jan last year → today.

  Insert:  python scripts/seed_overview_chart_dummy.py
  Remove:  python scripts/seed_overview_chart_dummy.py --remove
"""

from __future__ import annotations

import argparse
import uuid
from datetime import date, datetime, timezone

from app.database import SessionLocal
from app import models

SEED_NOTE = "SEED: overview chart dummy — safe to delete"
PENDING_NOTE = "SEED: overview pending dummy — safe to delete"
PARTNER_ID = "partner-001"
ADMIN_ID = uuid.UUID("97259915-6b79-4bd6-8253-504159f1ffa5")
ID_PREFIX = "dummy-chart-"
PENDING_PREFIX = "dummy-pending-"

# Small New Requests set for Pending-by-action donut (must stay tiny — serialize is costly).
# (action, first, last)
PENDING_PEOPLE = [
    ("Add", "Ada", "Pendone"),
    ("Add", "Ben", "Pendtwo"),
    ("Add", "Cara", "Pendthree"),
    ("Remove", "Fay", "Pendsix"),
]

def _build_dummy_points(now: datetime | None = None) -> list[tuple[int, int, int, int, int]]:
    """(year, month, day, received, handled) — every month of last year + this year to date."""
    now = now or datetime.now(timezone.utc)
    last_year = now.year - 1
    points: list[tuple[int, int, int, int, int]] = []

    # Last year: every month, chunky bars for Overview monthly granularity.
    last_year_volumes = [
        # (day, received, handled)
        (8, 10, 8),
        (12, 11, 9),
        (18, 12, 10),
        (9, 10, 9),
        (15, 13, 11),
        (6, 11, 9),
        (22, 14, 12),
        (14, 12, 10),
        (10, 11, 10),
        (20, 15, 13),
        (11, 12, 10),
        (5, 13, 11),
    ]
    for month, (day, received_n, handled_n) in enumerate(last_year_volumes, start=1):
        points.append((last_year, month, day, received_n, handled_n))

    # This year: three clusters per month so weekly + custom ranges still have bars.
    this_year_clusters = [
        (6, 5, 4),
        (13, 6, 5),
        (20, 5, 4),
    ]
    today = now.date()
    for month in range(1, now.month + 1):
        for day, received_n, handled_n in this_year_clusters:
            try:
                point_day = date(now.year, month, day)
            except ValueError:
                continue
            if point_day > today:
                continue
            points.append((now.year, month, day, received_n, handled_n))

    return points


DUMMY_POINTS = _build_dummy_points()


def remove_dummies(db) -> int:
    rows = (
        db.query(models.ManagerRequest)
        .filter(
            models.ManagerRequest.id.like(f"{ID_PREFIX}%")
            | models.ManagerRequest.id.like(f"{PENDING_PREFIX}%")
        )
        .all()
    )
    n = len(rows)
    for row in rows:
        db.delete(row)
    db.commit()
    return n


def _letters_name(n: int) -> str:
    """PersonInfo last names must be letters only (no digits)."""
    # aaa, aab, ... — always >= 3 letters
    n = max(0, n)
    chars = []
    x = n
    for _ in range(3):
        chars.append(chr(ord("a") + (x % 26)))
        x //= 26
    while x > 0:
        chars.append(chr(ord("a") + (x % 26)))
        x //= 26
    return "Chart" + "".join(reversed(chars))


def seed_pending(db) -> int:
    """A handful of status=new rows for Pending-by-action (Add vs Remove)."""
    now = datetime.now(timezone.utc)
    created = 0
    for i, (action, first, last) in enumerate(PENDING_PEOPLE, start=1):
        rid = f"{PENDING_PREFIX}{i:03d}"
        email = f"dummy.pending.{i}@example.com"
        row = models.ManagerRequest(
            id=rid,
            received_at=now,
            handled_at=None,
            handled_by_admin_id=None,
            person_first_name=first,
            person_last_name=last,
            person_email=email,
            person_location="London",
            action=action,
            manager_notes=PENDING_NOTE,
            tags=["verified", "partner req"],
            status="new",
            outcome=None,
            intake_persons={
                "partner": {
                    "firstName": first,
                    "lastName": last,
                    "email": email,
                    "location": "London",
                }
            },
            partner_id=PARTNER_ID,
        )
        db.add(row)
        created += 1
    db.commit()
    return created


def seed_dummies(db) -> int:
    remove_dummies(db)  # idempotent re-seed
    created = 0
    seq = 0
    for year, month, day, received_n, handled_n in DUMMY_POINTS:
        for i in range(received_n):
            seq += 1
            ts = datetime(year, month, day, 12, i % 12, 0, tzinfo=timezone.utc)
            # Chart rows stay out of New Requests (serialize is costly).
            # First handled_n rows count as handled; the rest are received-only (status closed).
            handled = i < handled_n
            rid = f"{ID_PREFIX}{year}-{month:02d}-{seq:03d}"
            email = f"dummy.chart.{year}.{month}.{seq}@example.com"
            last = _letters_name(seq)
            row = models.ManagerRequest(
                id=rid,
                received_at=ts,
                handled_at=ts if handled else None,
                handled_by_admin_id=ADMIN_ID if handled else None,
                person_first_name="Dummy",
                person_last_name=last,
                person_email=email,
                person_location="London",
                action="Add",
                manager_notes=SEED_NOTE,
                tags=["verified", "partner req"],
                status="handled" if handled else "closed",
                # Keep out of directory ledger — chart counts use received/handled timestamps only.
                outcome="Ignored" if handled else None,
                intake_persons={
                    "partner": {
                        "firstName": "Dummy",
                        "lastName": last,
                        "email": email,
                        "location": "London",
                    }
                },
                partner_id=PARTNER_ID,
            )
            db.add(row)
            created += 1
    db.commit()
    created += seed_pending(db)
    return created


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remove", action="store_true", help="Delete dummy chart rows")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        if args.remove:
            n = remove_dummies(db)
            print(f"Removed {n} dummy overview rows (chart + pending).")
        else:
            n = seed_dummies(db)
            print(f"Seeded {n} dummy Pure Gym rows (chart + pending).")
            print("Overview → Pending by action should show Add/Remove; Request flow uses date filter.")
            print("When done testing: python scripts/seed_overview_chart_dummy.py --remove")
    finally:
        db.close()


if __name__ == "__main__":
    main()
