-- Migration 036: Admin-learned "these nicknames are the same person" pairs.
-- Skips the nickname confirmation modal after Yes, same person.

CREATE TABLE IF NOT EXISTS confirmed_nickname_pairs (
    id VARCHAR PRIMARY KEY,
    name_a VARCHAR NOT NULL,
    name_b VARCHAR NOT NULL,
    confirmed_by_admin_id UUID REFERENCES powermusic_users(id) ON DELETE SET NULL,
    source_group_id VARCHAR REFERENCES duplicate_groups(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT confirmed_nickname_pairs_ordered CHECK (name_a <= name_b),
    CONSTRAINT confirmed_nickname_pairs_unique UNIQUE (name_a, name_b)
);

CREATE INDEX IF NOT EXISTS ix_confirmed_nickname_pairs_name_a ON confirmed_nickname_pairs(name_a);
CREATE INDEX IF NOT EXISTS ix_confirmed_nickname_pairs_name_b ON confirmed_nickname_pairs(name_b);
