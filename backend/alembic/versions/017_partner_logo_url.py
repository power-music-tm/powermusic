"""partner logo url column

Revision ID: 017_partner_logo_url
Revises: 78174f1b89fc
Create Date: 2026-08-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "017_partner_logo_url"
down_revision: Union[str, Sequence[str], None] = "78174f1b89fc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE partner_custom_forms ADD COLUMN IF NOT EXISTS logo_url TEXT"))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE partner_custom_forms DROP COLUMN IF EXISTS logo_url"))
