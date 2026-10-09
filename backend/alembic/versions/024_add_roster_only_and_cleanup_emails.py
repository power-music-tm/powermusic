"""add roster_only column to email_accounts and cleanup non-roster emails

Revision ID: 024_add_roster_only_and_cleanup_emails
Revises: 023_processed_gmail_messages
Create Date: 2026-10-09 18:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "024_add_roster_only_and_cleanup_emails"
down_revision = "023_processed_gmail_messages"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE connected_emails ADD COLUMN IF NOT EXISTS roster_only BOOLEAN NOT NULL DEFAULT true;")
    op.execute("ALTER TABLE email_accounts DROP COLUMN IF EXISTS roster_only;")

    # Clean up legacy non-roster email and attachment rows for roster_only inboxes
    op.execute(
        """
        DELETE FROM email_attachments 
        WHERE email_id IN (
            SELECT id FROM emails 
            WHERE account_email IN (
                SELECT email FROM connected_emails WHERE roster_only = true
            )
        );
        """
    )
    op.execute(
        """
        DELETE FROM emails 
        WHERE account_email IN (
            SELECT email FROM connected_emails WHERE roster_only = true
        );
        """
    )


def downgrade():
    op.execute("ALTER TABLE connected_emails DROP COLUMN IF EXISTS roster_only;")


