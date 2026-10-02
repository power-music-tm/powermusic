"""add threading metadata + forward pivot + outbound message ids on emails

Revision ID: 006_email_thread_metadata
Revises: 005_template_created_at
Create Date: 2026-07-08 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "006_email_thread_metadata"
down_revision: Union[str, Sequence[str], None] = "005_template_created_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Envelope recipients + snippet + HTML body
    op.add_column(
        "emails",
        sa.Column(
            "to_emails",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.add_column(
        "emails",
        sa.Column(
            "cc_emails",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.add_column("emails", sa.Column("html_body", sa.Text(), nullable=True))
    op.add_column("emails", sa.Column("snippet", sa.String(), nullable=True))

    # RFC 5322 threading headers
    op.add_column("emails", sa.Column("message_id_header", sa.String(), nullable=True))
    op.create_index(
        "ix_emails_message_id_header",
        "emails",
        ["message_id_header"],
        unique=False,
    )
    op.add_column("emails", sa.Column("in_reply_to_header", sa.String(), nullable=True))
    op.add_column("emails", sa.Column("references_header", sa.Text(), nullable=True))

    # Forward pivot
    op.add_column(
        "emails",
        sa.Column(
            "is_forward",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column("emails", sa.Column("forwarded_by_name", sa.String(), nullable=True))
    op.add_column("emails", sa.Column("forwarded_by_email", sa.String(), nullable=True))
    op.add_column("emails", sa.Column("original_from_name", sa.String(), nullable=True))
    op.add_column("emails", sa.Column("original_from_email", sa.String(), nullable=True))

    # Outbound send bookkeeping so history sync can dedupe Gmail's echo
    op.add_column("emails", sa.Column("sent_gmail_message_id", sa.String(), nullable=True))
    op.create_unique_constraint(
        "uq_emails_sent_gmail_message_id",
        "emails",
        ["sent_gmail_message_id"],
    )
    op.add_column("emails", sa.Column("sent_message_id_header", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("emails", "sent_message_id_header")
    op.drop_constraint("uq_emails_sent_gmail_message_id", "emails", type_="unique")
    op.drop_column("emails", "sent_gmail_message_id")

    op.drop_column("emails", "original_from_email")
    op.drop_column("emails", "original_from_name")
    op.drop_column("emails", "forwarded_by_email")
    op.drop_column("emails", "forwarded_by_name")
    op.drop_column("emails", "is_forward")

    op.drop_column("emails", "references_header")
    op.drop_column("emails", "in_reply_to_header")
    op.drop_index("ix_emails_message_id_header", table_name="emails")
    op.drop_column("emails", "message_id_header")

    op.drop_column("emails", "snippet")
    op.drop_column("emails", "html_body")
    op.drop_column("emails", "cc_emails")
    op.drop_column("emails", "to_emails")
