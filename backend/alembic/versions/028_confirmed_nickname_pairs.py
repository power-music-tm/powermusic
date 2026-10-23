"""confirmed_nickname_pairs

Revision ID: 028_confirmed_nickname_pairs
Revises: 027_rejected_nickname_pairs
Create Date: 2026-10-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "028_confirmed_nickname_pairs"
down_revision: Union[str, Sequence[str], None] = "027_rejected_nickname_pairs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "confirmed_nickname_pairs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name_a", sa.String(), nullable=False),
        sa.Column("name_b", sa.String(), nullable=False),
        sa.Column("confirmed_by_admin_id", sa.UUID(), nullable=True),
        sa.Column("source_group_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("name_a <= name_b", name="confirmed_nickname_pairs_ordered"),
        sa.ForeignKeyConstraint(["confirmed_by_admin_id"], ["powermusic_users.id"]),
        sa.ForeignKeyConstraint(["source_group_id"], ["duplicate_groups.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name_a", "name_b", name="confirmed_nickname_pairs_unique"),
    )
    op.create_index(
        op.f("ix_confirmed_nickname_pairs_name_a"),
        "confirmed_nickname_pairs",
        ["name_a"],
        unique=False,
    )
    op.create_index(
        op.f("ix_confirmed_nickname_pairs_name_b"),
        "confirmed_nickname_pairs",
        ["name_b"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_confirmed_nickname_pairs_name_b"), table_name="confirmed_nickname_pairs")
    op.drop_index(op.f("ix_confirmed_nickname_pairs_name_a"), table_name="confirmed_nickname_pairs")
    op.drop_table("confirmed_nickname_pairs")
