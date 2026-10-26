#!/usr/bin/env python3
"""Re-apply Directory matching after rule changes (exact email = confirmed).

1) Refresh active groups so missed Directory links / classifications update.
2) Backfill ungrouped new requests that should now join a Directory match.

Usage:
  python scripts/refresh_directory_email_matches.py --dry-run
  python scripts/refresh_directory_email_matches.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.duplicate_group_service import (
    backfill_duplicate_groups,
    refresh_active_groups_directory_links,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Refresh Directory links for open requests after email-match rule change.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Evaluate without committing (default: False).",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        print(f"=== Refresh active group Directory links (dry_run={args.dry_run}) ===")
        refresh_summary = refresh_active_groups_directory_links(db, dry_run=args.dry_run)
        print(json.dumps(refresh_summary, indent=2, default=str))

        print(f"\n=== Backfill ungrouped new requests (dry_run={args.dry_run}) ===")
        backfill_summary = backfill_duplicate_groups(db, dry_run=args.dry_run)
        print(json.dumps(backfill_summary, indent=2, default=str))

        if args.dry_run:
            print("\n[DRY RUN] Rolled back. Zero database changes were made.")
        else:
            print("\n[REAL RUN] Changes committed.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
