"""add resolution_metadata JSONB to duplicate_groups

Revision ID: 015_duplicate_group_resolution
Revises: 014_duplicate_groups
Create Date: 2026-08-07 00:00:00.000000

Adds a nullable JSONB column to duplicate_groups that is populated at resolve time
with an audit snapshot:
  {
    "resolution_type": "add" | "update" | "keep_existing",
    "final_values": {firstName, lastName, email, location},
    "previous_values": {firstName, lastName, email, location},  -- update only
    "admin_note": "..."
  }

Safe against existing rows: the column is nullable and no backfill is needed.
Existing production data is unaffected; already-resolved groups will simply have
resolution_metadata = NULL.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "015_duplicate_group_resolution"
down_revision: Union[str, Sequence[str], None] = "014_duplicate_groups"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE duplicate_groups ADD COLUMN IF NOT EXISTS resolution_metadata JSONB"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE duplicate_groups DROP COLUMN IF EXISTS resolution_metadata"
        )
    )
