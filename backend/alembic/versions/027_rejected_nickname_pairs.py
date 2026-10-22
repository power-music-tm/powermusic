"""rejected_nickname_pairs

Revision ID: 027_rejected_nickname_pairs
Revises: 026_drop_unused_ai_email_tables
Create Date: 2026-10-22 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "027_rejected_nickname_pairs"
down_revision: Union[str, Sequence[str], None] = "026_drop_unused_ai_email_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rejected_nickname_pairs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name_a", sa.String(), nullable=False),
        sa.Column("name_b", sa.String(), nullable=False),
        sa.Column("rejected_by_admin_id", sa.UUID(), nullable=True),
        sa.Column("source_group_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("name_a <= name_b", name="rejected_nickname_pairs_ordered"),
        sa.ForeignKeyConstraint(["rejected_by_admin_id"], ["powermusic_users.id"]),
        sa.ForeignKeyConstraint(["source_group_id"], ["duplicate_groups.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name_a", "name_b", name="rejected_nickname_pairs_unique"),
    )
    op.create_index(
        op.f("ix_rejected_nickname_pairs_name_a"),
        "rejected_nickname_pairs",
        ["name_a"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rejected_nickname_pairs_name_b"),
        "rejected_nickname_pairs",
        ["name_b"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_rejected_nickname_pairs_name_b"), table_name="rejected_nickname_pairs")
    op.drop_index(op.f("ix_rejected_nickname_pairs_name_a"), table_name="rejected_nickname_pairs")
    op.drop_table("rejected_nickname_pairs")
