"""admin_hidden_requests

Admin Delete / duplicate merges keep manager portal rows (status
'admin_deleted' / 'merged'); merged rows point at their survivor.

Revision ID: 029_admin_hidden_requests
Revises: 028_confirmed_nickname_pairs
Create Date: 2026-10-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "029_admin_hidden_requests"
down_revision: Union[str, Sequence[str], None] = "028_confirmed_nickname_pairs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "manager_requests",
        sa.Column("merged_into_request_id", sa.String(), nullable=True),
    )
    op.create_index(
        op.f("ix_manager_requests_merged_into_request_id"),
        "manager_requests",
        ["merged_into_request_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_manager_requests_merged_into_request_id"),
        table_name="manager_requests",
    )
    op.drop_column("manager_requests", "merged_into_request_id")
