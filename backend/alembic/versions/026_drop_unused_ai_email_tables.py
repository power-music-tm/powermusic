"""Drop unused AI inbox / draft tables (email UI removed).

Revision ID: 026_drop_unused_ai_email_tables
Revises: 025_add_manager_user_partner_id
Create Date: 2026-10-12 18:50:00.000000
"""

from alembic import op

revision = "026_drop_unused_ai_email_tables"
down_revision = "025_add_manager_user_partner_id"
branch_labels = None
depends_on = None

AI_TABLES = (
    "email_attachments",
    "draft_edits",
    "template_suggestions",
    "template_translations",
    "guidance_notes",
    "processing_logs",
    "email_ignore_rules",
    "email_templates",
    "emails",
)

LEFTOVER_TABLES = (
    "activities",
    "people",
    "profiles",
    "requests",
    "email_accounts",
)


def upgrade():
    op.execute(
        "ALTER TABLE manager_requests DROP CONSTRAINT IF EXISTS manager_requests_source_email_id_fkey"
    )
    op.execute(
        "ALTER TABLE manager_requests DROP CONSTRAINT IF EXISTS fk_manager_requests_source_email_id_emails"
    )
    for table in AI_TABLES + LEFTOVER_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")


def downgrade():
    # Intentionally empty — these tables are no longer part of the product.
    pass
