"""partner_custom_forms

Revision ID: 78174f1b89fc
Revises: 016_dismissed_group_matches
Create Date: 2026-08-12 19:55:22.716986

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '78174f1b89fc'
down_revision: Union[str, Sequence[str], None] = '016_dismissed_group_matches'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('partner_custom_forms',
        sa.Column('partner_id', sa.String(), nullable=False),
        sa.Column('logo_data_url', sa.Text(), nullable=True),
        sa.Column('fields', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
        sa.ForeignKeyConstraint(['partner_id'], ['partners.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('partner_id')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('partner_custom_forms')
