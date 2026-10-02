#!/usr/bin/env python3
"""Apply every supabase/migrations/*.sql file, in order, to a target database.

Usage:
    # applies to DATABASE_URL from backend/.env
    PYTHONPATH=. python scripts/apply_all_migrations.py

    # or point at a specific database (e.g. the new us-east-1 project)
    TARGET_DATABASE_URL="postgresql://..." PYTHONPATH=. python scripts/apply_all_migrations.py

Intended for provisioning a fresh project. Older migrations are not all
idempotent, so run this against a brand-new database only.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, text

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def _target_url() -> str:
    url = os.getenv("TARGET_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        print("Set TARGET_DATABASE_URL or DATABASE_URL", file=sys.stderr)
        raise SystemExit(1)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    if "sslmode=" not in url and "localhost" not in url and "127.0.0.1" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


def main() -> int:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print(f"No migrations found in {MIGRATIONS_DIR}", file=sys.stderr)
        return 1

    engine = create_engine(_target_url())
    for path in files:
        sql = path.read_text()
        print(f"Applying {path.name} ...", flush=True)
        with engine.begin() as conn:
            conn.execute(text(sql))
    print(f"Done: applied {len(files)} migrations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
