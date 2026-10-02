"""add per-inbox scope to email templates

Revision ID: 003_template_inbox_scope
Revises: 002_gmail_sync_columns
Create Date: 2026-07-03 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import sessionmaker

revision: str = "003_template_inbox_scope"
down_revision: Union[str, Sequence[str], None] = "002_gmail_sync_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _next_template_id(db, prefix: str = "tmpl") -> str:
    from app import models

    max_num = 0
    for (row_id,) in db.query(models.EmailTemplate.id).all():
        if row_id and row_id.startswith(f"{prefix}-"):
            try:
                max_num = max(max_num, int(row_id.split("-")[1]))
            except ValueError:
                pass
    return f"{prefix}-{max_num + 1:03d}"


def upgrade() -> None:
    op.add_column("email_templates", sa.Column("account_email", sa.String(), nullable=True))
    op.create_index("ix_email_templates_account_email", "email_templates", ["account_email"])

    bind = op.get_bind()
    Session = sessionmaker(bind=bind)
    db = Session()
    try:
        from app import models

        accounts = db.query(models.EmailAccount).order_by(models.EmailAccount.id).all()
        templates = db.query(models.EmailTemplate).all()
        if accounts and templates:
            primary = accounts[0].email
            for template in templates:
                if not template.account_email:
                    template.account_email = primary
            db.flush()

            next_id = _next_template_id(db)
            for account in accounts[1:]:
                for template in templates:
                    exists = (
                        db.query(models.EmailTemplate)
                        .filter(
                            models.EmailTemplate.account_email == account.email,
                            models.EmailTemplate.name == template.name,
                        )
                        .first()
                    )
                    if exists:
                        continue
                    db.add(
                        models.EmailTemplate(
                            id=next_id,
                            account_email=account.email,
                            name=template.name,
                            category=template.category,
                            intent=template.intent,
                            status=template.status,
                            subject=template.subject,
                            body=template.body,
                            times_used=0,
                            last_updated=template.last_updated,
                        )
                    )
                    prefix, num = next_id.rsplit("-", 1)
                    next_id = f"{prefix}-{int(num) + 1:03d}"
            db.commit()
    finally:
        db.close()

    op.alter_column("email_templates", "account_email", nullable=False)


def downgrade() -> None:
    op.drop_index("ix_email_templates_account_email", table_name="email_templates")
    op.drop_column("email_templates", "account_email")
