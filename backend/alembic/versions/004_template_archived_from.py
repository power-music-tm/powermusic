"""remember template status when archived

Revision ID: 004_template_archived_from
Revises: 003_template_inbox_scope
Create Date: 2026-07-03 13:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004_template_archived_from"
down_revision: Union[str, Sequence[str], None] = "003_template_inbox_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("email_templates", sa.Column("archived_from", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("email_templates", "archived_from")
