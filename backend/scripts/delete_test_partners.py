#!/usr/bin/env python3
"""Delete test partners by name. Run from backend/: python scripts/delete_test_partners.py"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import SessionLocal
from app import models
from app.partner_allowlists import delete_partner, list_partners
from app.partner_logo_storage import delete_partner_logo

TEST_PARTNER_NAMES = {
    "heyi",
    "new",
    "New Partner",
    "ol",
    "vector",
    "whatsup",
}


def main() -> int:
    db = SessionLocal()
    try:
        partners = list_partners(db)
        targets = [p for p in partners if p.name in TEST_PARTNER_NAMES]
        if not targets:
            print("No matching test partners found.")
            for partner in partners:
                print(f"  - {partner.id}: {partner.name}")
            return 0

        for partner in targets:
            print(f"Deleting {partner.id} ({partner.name})…")
            delete_partner_logo(partner.id)
            delete_partner(db, partner.id)
            print(f"  deleted {partner.name}")

        remaining = db.query(models.Partner).order_by(models.Partner.name.asc()).all()
        print("\nRemaining partners:")
        for partner in remaining:
            print(f"  - {partner.id}: {partner.name}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
