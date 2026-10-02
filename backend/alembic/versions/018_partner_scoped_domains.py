"""scope manager allowed domains and automated sources to partner_id

Revision ID: 018_partner_scoped_domains
Revises: 017_partner_logo_url
Create Date: 2026-08-18 15:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "018_partner_scoped_domains"
down_revision: Union[str, Sequence[str], None] = "017_partner_logo_url"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Manager allowed domains: drop global unique constraint, add composite (partner_id, domain) constraint
    op.execute(
        sa.text(
            "ALTER TABLE manager_allowed_domains DROP CONSTRAINT IF EXISTS uq_manager_allowed_domains_domain"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE manager_allowed_domains DROP CONSTRAINT IF EXISTS manager_allowed_domains_domain_key"
        )
    )
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'uq_manager_partner_domain'
                ) THEN
                    ALTER TABLE manager_allowed_domains
                    ADD CONSTRAINT uq_manager_partner_domain UNIQUE (partner_id, domain);
                END IF;
            END
            $$;
            """
        )
    )

    # 2. Automated roster sources: drop global unique constraint, add composite (partner_id, kind, pattern) constraint
    op.execute(
        sa.text(
            "ALTER TABLE automated_roster_sources DROP CONSTRAINT IF EXISTS uq_automated_roster_sources_kind_pattern"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE automated_roster_sources DROP CONSTRAINT IF EXISTS automated_roster_sources_kind_pattern_key"
        )
    )
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'uq_automated_roster_sources_partner_kind_pattern'
                ) THEN
                    ALTER TABLE automated_roster_sources
                    ADD CONSTRAINT uq_automated_roster_sources_partner_kind_pattern UNIQUE (partner_id, kind, pattern);
                END IF;
            END
            $$;
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE automated_roster_sources DROP CONSTRAINT IF EXISTS uq_automated_roster_sources_partner_kind_pattern"
        )
    )
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'uq_automated_roster_sources_kind_pattern'
                ) THEN
                    ALTER TABLE automated_roster_sources
                    ADD CONSTRAINT uq_automated_roster_sources_kind_pattern UNIQUE (kind, pattern);
                END IF;
            END
            $$;
            """
        )
    )

    op.execute(
        sa.text(
            "ALTER TABLE manager_allowed_domains DROP CONSTRAINT IF EXISTS uq_manager_partner_domain"
        )
    )
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'uq_manager_allowed_domains_domain'
                ) THEN
                    ALTER TABLE manager_allowed_domains
                    ADD CONSTRAINT uq_manager_allowed_domains_domain UNIQUE (domain);
                END IF;
            END
            $$;
            """
        )
    )
