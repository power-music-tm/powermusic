#!/usr/bin/env python3
"""
CLI script to run duplicate group backfill on existing unhandled requests.

Usage:
  # Dry-run (reports what it WOULD do without committing any changes):
  python scripts/backfill_duplicate_groups.py --dry-run

  # Execute for real (commits classification, groups, and tags to DB):
  python scripts/backfill_duplicate_groups.py
"""

import argparse
import json
import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.duplicate_group_service import backfill_duplicate_groups


def main():
    parser = argparse.ArgumentParser(description="Backfill duplicate groups for unhandled requests.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run evaluation without committing changes to DB (default: False).",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        print(f"=== Starting Duplicate Group Backfill (dry_run={args.dry_run}) ===")
        results = backfill_duplicate_groups(db, dry_run=args.dry_run)
        print("\n=== Backfill Summary ===")
        print(json.dumps(results, indent=2))
        if args.dry_run:
            print("\n[DRY RUN] Transaction rolled back. Zero database changes were made.")
        else:
            print("\n[REAL RUN] Changes successfully committed to database.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
