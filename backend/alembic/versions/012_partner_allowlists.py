"""partner manager domains + automated roster email sources

Revision ID: 012_partner_allowlists
Revises: 011_template_embeddings
Create Date: 2026-07-14 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012_partner_allowlists"
down_revision: Union[str, Sequence[str], None] = "011_template_embeddings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS manager_allowed_domains (
                id VARCHAR NOT NULL PRIMARY KEY,
                domain VARCHAR NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT uq_manager_allowed_domains_domain UNIQUE (domain)
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS automated_roster_sources (
                id VARCHAR NOT NULL PRIMARY KEY,
                kind VARCHAR NOT NULL,
                pattern VARCHAR NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT uq_automated_roster_sources_kind_pattern UNIQUE (kind, pattern)
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO manager_allowed_domains (id, domain, created_at)
            SELECT 'mad-001', 'puregym.com', NOW()
            WHERE NOT EXISTS (
              SELECT 1 FROM manager_allowed_domains WHERE domain = 'puregym.com'
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO automated_roster_sources (id, kind, pattern, created_at)
            SELECT 'ars-001', 'domain', 'puregym.com', NOW()
            WHERE NOT EXISTS (
              SELECT 1 FROM automated_roster_sources WHERE kind = 'domain' AND pattern = 'puregym.com'
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO automated_roster_sources (id, kind, pattern, created_at)
            SELECT 'ars-002', 'email', 'em@myptzone.co', NOW()
            WHERE NOT EXISTS (
              SELECT 1 FROM automated_roster_sources WHERE kind = 'email' AND pattern = 'em@myptzone.co'
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO automated_roster_sources (id, kind, pattern, created_at)
            SELECT 'ars-003', 'email', 'rubabzahra248@gmail.com', NOW()
            WHERE NOT EXISTS (
              SELECT 1 FROM automated_roster_sources WHERE kind = 'email' AND pattern = 'rubabzahra248@gmail.com'
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_table("automated_roster_sources")
    op.drop_table("manager_allowed_domains")
