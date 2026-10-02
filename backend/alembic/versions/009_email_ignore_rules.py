"""email ignore rules for Andrea-managed sender blocklist

Revision ID: 009_email_ignore_rules
Revises: 008_gmail_watch_expiration
Create Date: 2026-07-09 01:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009_email_ignore_rules"
down_revision: Union[str, Sequence[str], None] = "008_gmail_watch_expiration"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_ignore_rules",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("account_email", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("pattern", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_ignore_rules_account_email", "email_ignore_rules", ["account_email"])
    op.create_index(
        "uq_email_ignore_rules_inbox_kind_pattern",
        "email_ignore_rules",
        ["account_email", "kind", "pattern"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_email_ignore_rules_inbox_kind_pattern", table_name="email_ignore_rules")
    op.drop_index("ix_email_ignore_rules_account_email", table_name="email_ignore_rules")
    op.drop_table("email_ignore_rules")
