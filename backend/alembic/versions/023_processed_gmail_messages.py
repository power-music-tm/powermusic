"""create processed_gmail_messages table

Revision ID: 023_processed_gmail_messages
Revises: 022_unique_source_gmail_message_id
Create Date: 2026-10-09 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "023_processed_gmail_messages"
down_revision = "022_unique_source_gmail_message_id"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS processed_gmail_messages (
            gmail_message_id VARCHAR NOT NULL PRIMARY KEY,
            processed_at TIMESTAMP WITH TIME ZONE NOT NULL,
            account_email VARCHAR
        );
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ix_processed_gmail_messages_gmail_message_id 
        ON processed_gmail_messages (gmail_message_id);
        """
    )


def downgrade():
    op.drop_index(
        "ix_processed_gmail_messages_gmail_message_id",
        table_name="processed_gmail_messages",
    )
    op.drop_table("processed_gmail_messages")
