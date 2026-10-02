"""add partners and partner ownership to existing config and requests

Revision ID: 013_partner_architecture
Revises: 012_partner_allowlists
Create Date: 2026-08-07 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "013_partner_architecture"
down_revision: Union[str, Sequence[str], None] = "012_partner_allowlists"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PARTNER_ID = "partner-001"


def _ensure_constraint(table: str, constraint_name: str, ddl: str) -> None:
    op.execute(
        sa.text(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = '{constraint_name}'
                ) THEN
                    {ddl};
                END IF;
            END
            $$;
            """
        )
    )


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS partners (
                id VARCHAR NOT NULL PRIMARY KEY,
                name VARCHAR NOT NULL UNIQUE,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
            """
        )
    )

    op.execute(
        sa.text(
            "INSERT INTO partners (id, name, created_at, updated_at) VALUES ('partner-001', 'Pure Gym', NOW(), NOW()) ON CONFLICT (id) DO NOTHING"
        )
    )

    for table in ["manager_requests", "manager_allowed_domains", "automated_roster_sources", "connected_emails"]:
        op.execute(sa.text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS partner_id VARCHAR"))
        op.execute(sa.text(f"CREATE INDEX IF NOT EXISTS ix_{table}_partner_id ON {table} (partner_id)"))
        op.execute(sa.text(f"UPDATE {table} SET partner_id = '{PARTNER_ID}' WHERE partner_id IS NULL"))

    _ensure_constraint(
        "manager_requests",
        "fk_manager_requests_partner_id_partners",
        "ALTER TABLE manager_requests ADD CONSTRAINT fk_manager_requests_partner_id_partners FOREIGN KEY (partner_id) REFERENCES partners (id)",
    )
    _ensure_constraint(
        "manager_allowed_domains",
        "fk_manager_allowed_domains_partner_id_partners",
        "ALTER TABLE manager_allowed_domains ADD CONSTRAINT fk_manager_allowed_domains_partner_id_partners FOREIGN KEY (partner_id) REFERENCES partners (id)",
    )
    _ensure_constraint(
        "automated_roster_sources",
        "fk_automated_roster_sources_partner_id_partners",
        "ALTER TABLE automated_roster_sources ADD CONSTRAINT fk_automated_roster_sources_partner_id_partners FOREIGN KEY (partner_id) REFERENCES partners (id)",
    )
    _ensure_constraint(
        "connected_emails",
        "fk_connected_emails_partner_id_partners",
        "ALTER TABLE connected_emails ADD CONSTRAINT fk_connected_emails_partner_id_partners FOREIGN KEY (partner_id) REFERENCES partners (id)",
    )


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE connected_emails DROP CONSTRAINT IF EXISTS fk_connected_emails_partner_id_partners"))
    op.execute(sa.text("ALTER TABLE automated_roster_sources DROP CONSTRAINT IF EXISTS fk_automated_roster_sources_partner_id_partners"))
    op.execute(sa.text("ALTER TABLE manager_allowed_domains DROP CONSTRAINT IF EXISTS fk_manager_allowed_domains_partner_id_partners"))
    op.execute(sa.text("ALTER TABLE manager_requests DROP CONSTRAINT IF EXISTS fk_manager_requests_partner_id_partners"))

    for table in ["connected_emails", "automated_roster_sources", "manager_allowed_domains", "manager_requests"]:
        op.execute(sa.text(f"DROP INDEX IF EXISTS ix_{table}_partner_id"))
        op.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS partner_id"))

    op.execute(sa.text("DROP TABLE IF EXISTS partners"))
