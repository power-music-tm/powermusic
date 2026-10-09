"""enforce unique source_gmail_message_id on manager_requests

Revision ID: 022_unique_source_gmail_message_id
Revises: 021_add_manager_request_role
Create Date: 2026-10-09 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "022_unique_source_gmail_message_id"
down_revision: Union[str, Sequence[str], None] = "021_add_manager_request_role"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_requests_source_gmail_message_id
            ON manager_requests (source_gmail_message_id)
            WHERE source_gmail_message_id IS NOT NULL AND source_gmail_message_id != '';
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            DROP INDEX IF EXISTS uq_manager_requests_source_gmail_message_id;
            """
        )
    )
