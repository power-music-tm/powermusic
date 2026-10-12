"""add partner_id to powermusic_users and backfill from manager_requests

Revision ID: 025_add_manager_user_partner_id
Revises: 024_add_roster_only_and_cleanup_emails
Create Date: 2026-10-12 14:05:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "025_add_manager_user_partner_id"
down_revision = "024_add_roster_only_and_cleanup_emails"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        ALTER TABLE powermusic_users 
        ADD COLUMN IF NOT EXISTS partner_id VARCHAR REFERENCES partners(id) ON DELETE SET NULL;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_powermusic_users_partner_id 
        ON powermusic_users(partner_id);
        """
    )

    # Backfill existing managers who have submitted requests
    op.execute(
        """
        UPDATE powermusic_users u
        SET partner_id = r.partner_id
        FROM (
            SELECT DISTINCT ON (manager_id) manager_id, partner_id
            FROM manager_requests
            WHERE manager_id IS NOT NULL AND partner_id IS NOT NULL
            ORDER BY manager_id, received_at DESC
        ) r
        WHERE u.id = r.manager_id AND u.partner_id IS NULL;
        """
    )


def downgrade():
    op.execute("ALTER TABLE powermusic_users DROP COLUMN IF EXISTS partner_id;")
