"""template semantic-match embeddings (pgvector)

Adds a pgvector `embedding` column to email_templates so inbound emails can be
matched to templates by meaning (embedding similarity) instead of the brittle
`intent` label. The column is managed via raw SQL in the app, not the ORM.

Revision ID: 011_template_embeddings
Revises: 010_template_suggestion_source
Create Date: 2026-07-09 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "011_template_embeddings"
down_revision: Union[str, Sequence[str], None] = "010_template_suggestion_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS embedding vector(768)")


def downgrade() -> None:
    op.execute("ALTER TABLE email_templates DROP COLUMN IF EXISTS embedding")
