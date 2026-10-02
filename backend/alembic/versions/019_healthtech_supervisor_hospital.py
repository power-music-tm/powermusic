"""add supervisor and hospital columns to manager_requests

Revision ID: 019_healthtech_supervisor_hospital
Revises: 018_partner_scoped_domains
Create Date: 2026-08-27 00:00:00.000000
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "019_healthtech_supervisor_hospital"
down_revision: Union[str, Sequence[str], None] = "018_partner_scoped_domains"
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
                    WHERE table_name = 'manager_requests' AND column_name = 'supervisor'
                ) THEN
                    ALTER TABLE manager_requests ADD COLUMN supervisor VARCHAR;
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'manager_requests' AND column_name = 'hospital'
                ) THEN
                    ALTER TABLE manager_requests ADD COLUMN hospital VARCHAR;
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
            ALTER TABLE manager_requests DROP COLUMN IF EXISTS supervisor;
            ALTER TABLE manager_requests DROP COLUMN IF EXISTS hospital;
            """
        )
    )
