"""add email_attachments table

Revision ID: 007_email_attachments
Revises: 006_email_thread_metadata
Create Date: 2026-07-08 18:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007_email_attachments"
down_revision: Union[str, Sequence[str], None] = "006_email_thread_metadata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_attachments",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("email_id", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column(
            "mime_type",
            sa.String(),
            nullable=False,
            server_default="application/octet-stream",
        ),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("gmail_attachment_id", sa.Text(), nullable=True),
        sa.Column("content_base64", sa.Text(), nullable=True),
        sa.Column("is_inline", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("content_id", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["email_id"], ["emails.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_email_attachments_email_id",
        "email_attachments",
        ["email_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_email_attachments_email_id", table_name="email_attachments")
    op.drop_table("email_attachments")
