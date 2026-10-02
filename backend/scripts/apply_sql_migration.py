#!/usr/bin/env python3
"""Apply a single Supabase SQL migration file to DATABASE_URL."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import text

from app.database import engine


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/apply_sql_migration.py <path-to.sql>", file=sys.stderr)
        return 1

    sql_path = Path(sys.argv[1])
    if not sql_path.is_file():
        print(f"File not found: {sql_path}", file=sys.stderr)
        return 1

    sql = sql_path.read_text()
    with engine.begin() as conn:
        conn.execute(text(sql))
    print(f"Applied migration: {sql_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
