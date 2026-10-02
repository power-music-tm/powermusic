"""add gmail sync columns for backfill and label mirroring

Revision ID: 002_gmail_sync_columns
Revises: 001_create_core_tables
Create Date: 2026-07-03 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002_gmail_sync_columns"
down_revision: Union[str, Sequence[str], None] = "001_create_core_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "email_accounts",
        sa.Column("backfill_status", sa.String(), nullable=False, server_default="idle"),
    )
    op.add_column(
        "email_accounts",
        sa.Column("backfill_imported_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("email_accounts", sa.Column("backfill_error", sa.Text(), nullable=True))

    op.add_column(
        "emails",
        sa.Column(
            "gmail_label_ids",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.add_column(
        "emails",
        sa.Column("gmail_in_inbox", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "emails",
        sa.Column("gmail_in_trash", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "emails",
        sa.Column("gmail_in_sent", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "emails",
        sa.Column("gmail_starred", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "emails",
        sa.Column("gmail_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "emails",
        sa.Column("gmail_is_outbound", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("emails", "gmail_is_outbound")
    op.drop_column("emails", "gmail_archived")
    op.drop_column("emails", "gmail_starred")
    op.drop_column("emails", "gmail_in_sent")
    op.drop_column("emails", "gmail_in_trash")
    op.drop_column("emails", "gmail_in_inbox")
    op.drop_column("emails", "gmail_label_ids")
    op.drop_column("email_accounts", "backfill_error")
    op.drop_column("email_accounts", "backfill_imported_count")
    op.drop_column("email_accounts", "backfill_status")
