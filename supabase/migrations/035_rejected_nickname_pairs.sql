-- Migration 035: Admin-learned "these nicknames are different" pairs
-- Used when Keep Existing and Add New confirms a nickname-only first-name false positive.

CREATE TABLE IF NOT EXISTS rejected_nickname_pairs (
    id VARCHAR PRIMARY KEY,
    name_a VARCHAR NOT NULL,
    name_b VARCHAR NOT NULL,
    rejected_by_admin_id UUID REFERENCES powermusic_users(id) ON DELETE SET NULL,
    source_group_id VARCHAR REFERENCES duplicate_groups(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT rejected_nickname_pairs_ordered CHECK (name_a <= name_b),
    CONSTRAINT rejected_nickname_pairs_unique UNIQUE (name_a, name_b)
);

CREATE INDEX IF NOT EXISTS ix_rejected_nickname_pairs_name_a ON rejected_nickname_pairs(name_a);
CREATE INDEX IF NOT EXISTS ix_rejected_nickname_pairs_name_b ON rejected_nickname_pairs(name_b);
