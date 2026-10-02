"""template suggestion metadata for inbox scoping

Revision ID: 010_template_suggestion_source
Revises: 009_email_ignore_rules
Create Date: 2026-07-09 02:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010_template_suggestion_source"
down_revision: Union[str, Sequence[str], None] = "009_email_ignore_rules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("template_suggestions", sa.Column("source_email_id", sa.String(), nullable=True))
    op.add_column("template_suggestions", sa.Column("account_email", sa.String(), nullable=True))
    op.create_index("ix_template_suggestions_source_email_id", "template_suggestions", ["source_email_id"])
    op.create_index("ix_template_suggestions_account_email", "template_suggestions", ["account_email"])


def downgrade() -> None:
    op.drop_index("ix_template_suggestions_account_email", table_name="template_suggestions")
    op.drop_index("ix_template_suggestions_source_email_id", table_name="template_suggestions")
    op.drop_column("template_suggestions", "account_email")
    op.drop_column("template_suggestions", "source_email_id")
