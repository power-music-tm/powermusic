"""add role column to manager_requests

Revision ID: 021_add_manager_request_role
Revises: 020_drop_supervisor_hospital
Create Date: 2026-09-24 00:00:00.000000
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "021_add_manager_request_role"
down_revision: Union[str, Sequence[str], None] = "020_drop_supervisor_hospital"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'manager_requests' AND column_name = 'role'
                ) THEN
                    ALTER TABLE manager_requests ADD COLUMN role VARCHAR;
                END IF;
            END
            $$;
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            ALTER TABLE manager_requests DROP COLUMN IF EXISTS role;
            """
        )
    )
