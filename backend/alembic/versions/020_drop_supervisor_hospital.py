"""Drop obsolete supervisor and hospital columns from manager_requests.

Context: The previous HealthTech implementation (019_healthtech_supervisor_hospital)
added supervisor and hospital columns to manager_requests. After requirements
review, Health Fitness uses the same 4-field architecture as PureGym:
first name, last name, email, and location/client. The location column
(person_location) stores the "client" value for Health Fitness — no separate
physical column is required.

This is a safe forward migration. Existing partner_id, person_location, and all
other manager_requests data are preserved unchanged.

Revision ID: 020_drop_supervisor_hospital
Revises: 019_healthtech_supervisor_hospital
Create Date: 2026-08-31 00:00:00.000000
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "020_drop_supervisor_hospital"
down_revision: Union[str, Sequence[str], None] = "019_healthtech_supervisor_hospital"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'manager_requests' AND column_name = 'supervisor'
                ) THEN
                    ALTER TABLE manager_requests DROP COLUMN supervisor;
                END IF;

                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'manager_requests' AND column_name = 'hospital'
                ) THEN
                    ALTER TABLE manager_requests DROP COLUMN hospital;
                END IF;
            END
            $$;
            """
        )
    )


def downgrade() -> None:
    # Re-add the columns as nullable so downgrade does not lose data.
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
