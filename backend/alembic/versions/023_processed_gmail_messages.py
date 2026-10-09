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
    op.create_table(
        "processed_gmail_messages",
        sa.Column("gmail_message_id", sa.String(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("account_email", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("gmail_message_id"),
    )
    op.create_index(
        "ix_processed_gmail_messages_gmail_message_id",
        "processed_gmail_messages",
        ["gmail_message_id"],
        unique=True,
    )


def downgrade():
    op.drop_index(
        "ix_processed_gmail_messages_gmail_message_id",
        table_name="processed_gmail_messages",
    )
    op.drop_table("processed_gmail_messages")
