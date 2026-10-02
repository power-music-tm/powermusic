"""add created_at to email templates

Revision ID: 005_template_created_at
Revises: 004_template_archived_from
Create Date: 2026-07-03 16:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005_template_created_at"
down_revision: Union[str, Sequence[str], None] = "004_template_archived_from"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("email_templates", sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE email_templates SET created_at = last_updated WHERE created_at IS NULL")
    op.alter_column("email_templates", "created_at", nullable=False)


def downgrade() -> None:
    op.drop_column("email_templates", "created_at")
