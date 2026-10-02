"""add watch_expiration to connected_emails (Gmail push watch lifecycle)

Revision ID: 008_gmail_watch_expiration
Revises: 007_email_attachments
Create Date: 2026-07-08 19:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008_gmail_watch_expiration"
down_revision: Union[str, Sequence[str], None] = "007_email_attachments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "connected_emails",
        sa.Column("watch_expiration", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("connected_emails", "watch_expiration")
