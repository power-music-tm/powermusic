"""add duplicate_groups, dismissed_duplicate_matches, and duplicate_group_id on manager_requests

Revision ID: 014_duplicate_groups
Revises: 013_partner_architecture
Create Date: 2026-08-07 00:00:00.000000

This migration mirrors supabase/migrations/031_duplicate_request_groups.sql so that
``alembic upgrade head`` works on fresh local environments and CI without requiring
a separate manual Supabase SQL Editor run.

All DDL uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so running this migration
against a Supabase instance where 031_duplicate_request_groups.sql has already been
applied is a safe no-op.

No existing rows are modified. No backfill is performed.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014_duplicate_groups"
down_revision: Union[str, Sequence[str], None] = "013_partner_architecture"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── duplicate_groups ────────────────────────────────────────────────────────
    # Create the group table first because manager_requests will FK to it.
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS duplicate_groups (
                id VARCHAR PRIMARY KEY,
                partner_id VARCHAR REFERENCES partners(id) ON DELETE SET NULL,
                classification VARCHAR NOT NULL,
                status VARCHAR NOT NULL DEFAULT 'active',
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                resolved_at TIMESTAMP WITH TIME ZONE,
                resolved_by_admin_id UUID REFERENCES powermusic_users(id) ON DELETE SET NULL,
                directory_person_id VARCHAR REFERENCES manager_requests(id) ON DELETE SET NULL,
                representative_request_id VARCHAR REFERENCES manager_requests(id) ON DELETE SET NULL
            )
            """
        )
    )

    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS ix_duplicate_groups_partner_id ON duplicate_groups(partner_id)"
        )
    )

    # ── duplicate_group_id on manager_requests ──────────────────────────────────
    op.execute(
        sa.text(
            "ALTER TABLE manager_requests ADD COLUMN IF NOT EXISTS duplicate_group_id VARCHAR"
        )
    )

    # Add FK only if not already present (guard against re-runs).
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'fk_manager_requests_duplicate_group_id'
                ) THEN
                    ALTER TABLE manager_requests
                    ADD CONSTRAINT fk_manager_requests_duplicate_group_id
                    FOREIGN KEY (duplicate_group_id)
                    REFERENCES duplicate_groups(id)
                    ON DELETE SET NULL;
                END IF;
            END
            $$
            """
        )
    )

    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS ix_manager_requests_duplicate_group_id ON manager_requests(duplicate_group_id)"
        )
    )

    # ── dismissed_duplicate_matches ─────────────────────────────────────────────
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS dismissed_duplicate_matches (
                id VARCHAR PRIMARY KEY,
                request_id_1 VARCHAR NOT NULL REFERENCES manager_requests(id) ON DELETE CASCADE,
                request_id_2 VARCHAR NOT NULL REFERENCES manager_requests(id) ON DELETE CASCADE,
                dismissed_by_admin_id UUID REFERENCES powermusic_users(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )

    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS ix_dismissed_duplicate_matches_r1 ON dismissed_duplicate_matches(request_id_1)"
        )
    )
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS ix_dismissed_duplicate_matches_r2 ON dismissed_duplicate_matches(request_id_2)"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS dismissed_duplicate_matches"))

    op.execute(
        sa.text(
            "ALTER TABLE manager_requests DROP CONSTRAINT IF EXISTS fk_manager_requests_duplicate_group_id"
        )
    )
    op.execute(
        sa.text(
            "DROP INDEX IF EXISTS ix_manager_requests_duplicate_group_id"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE manager_requests DROP COLUMN IF EXISTS duplicate_group_id"
        )
    )

    op.execute(sa.text("DROP INDEX IF EXISTS ix_duplicate_groups_partner_id"))
    op.execute(sa.text("DROP TABLE IF EXISTS duplicate_groups"))
