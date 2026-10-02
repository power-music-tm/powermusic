"""dismissed_group_matches

Revision ID: f243388d49a7
Revises: 015_duplicate_group_resolution
Create Date: 2026-08-10 13:43:29.064009

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '016_dismissed_group_matches'
down_revision: Union[str, Sequence[str], None] = '015_duplicate_group_resolution'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.create_table('dismissed_group_matches',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('request_id', sa.String(), nullable=False),
    sa.Column('group_id', sa.String(), nullable=False),
    sa.Column('dismissed_by_admin_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['dismissed_by_admin_id'], ['powermusic_users.id'], ),
    sa.ForeignKeyConstraint(['group_id'], ['duplicate_groups.id'], ),
    sa.ForeignKeyConstraint(['request_id'], ['manager_requests.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_dismissed_group_matches_group_id'), 'dismissed_group_matches', ['group_id'], unique=False)
    op.create_index(op.f('ix_dismissed_group_matches_request_id'), 'dismissed_group_matches', ['request_id'], unique=False)

def downgrade() -> None:
    op.drop_index(op.f('ix_dismissed_group_matches_request_id'), table_name='dismissed_group_matches')
    op.drop_index(op.f('ix_dismissed_group_matches_group_id'), table_name='dismissed_group_matches')
    op.drop_table('dismissed_group_matches')
