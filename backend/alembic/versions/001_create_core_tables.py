"""create requests and people tables

Revision ID: 001_create_core_tables
Revises:
Create Date: 2026-07-01 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001_create_core_tables"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS request_id_seq START WITH 1")
    op.execute("CREATE SEQUENCE IF NOT EXISTS person_id_seq START WITH 1")

    op.create_table(
        "requests",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_by_first_name", sa.String(), nullable=False),
        sa.Column("submitted_by_last_name", sa.String(), nullable=False),
        sa.Column("submitted_by_email", sa.String(), nullable=False),
        sa.Column("submitted_by_club", sa.String(), nullable=False),
        sa.Column("person_first_name", sa.String(), nullable=False),
        sa.Column("person_last_name", sa.String(), nullable=False),
        sa.Column("person_email", sa.String(), nullable=False),
        sa.Column("person_location", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "people",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("first_name", sa.String(), nullable=False),
        sa.Column("last_name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("location", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("date_added", sa.DateTime(timezone=True), nullable=False),
        sa.Column("added_by", sa.String(), nullable=False),
        sa.Column("manager_email", sa.String(), nullable=False),
        sa.Column("club", sa.String(), nullable=False),
        sa.Column("source_request_id", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("people")
    op.drop_table("requests")
    op.execute("DROP SEQUENCE IF EXISTS person_id_seq")
    op.execute("DROP SEQUENCE IF EXISTS request_id_seq")
