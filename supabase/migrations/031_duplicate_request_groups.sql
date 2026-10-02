-- Migration 031: Duplicate Request Groups & Unlink Persistence
-- Create duplicate_groups table to logically group related manager requests without modifying original request rows.

CREATE TABLE IF NOT EXISTS duplicate_groups (
    id VARCHAR PRIMARY KEY,
    partner_id VARCHAR REFERENCES partners(id) ON DELETE SET NULL,
    classification VARCHAR NOT NULL, -- 'confirmed_duplicate', 'potential_duplicate', 'already_exists', 'already_exists_conflict'
    status VARCHAR NOT NULL DEFAULT 'active', -- 'active', 'resolved', 'dismissed'
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by_admin_id UUID REFERENCES powermusic_users(id) ON DELETE SET NULL,
    directory_person_id VARCHAR REFERENCES manager_requests(id) ON DELETE SET NULL,
    representative_request_id VARCHAR REFERENCES manager_requests(id) ON DELETE SET NULL
);

-- Add duplicate_group_id column to manager_requests
ALTER TABLE manager_requests
ADD COLUMN IF NOT EXISTS duplicate_group_id VARCHAR REFERENCES duplicate_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_manager_requests_duplicate_group_id ON manager_requests(duplicate_group_id);
CREATE INDEX IF NOT EXISTS ix_duplicate_groups_partner_id ON duplicate_groups(partner_id);

-- Create dismissed_duplicate_matches table to store admin unlink / false positive decisions
CREATE TABLE IF NOT EXISTS dismissed_duplicate_matches (
    id VARCHAR PRIMARY KEY,
    request_id_1 VARCHAR NOT NULL REFERENCES manager_requests(id) ON DELETE CASCADE,
    request_id_2 VARCHAR NOT NULL REFERENCES manager_requests(id) ON DELETE CASCADE,
    dismissed_by_admin_id UUID REFERENCES powermusic_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_dismissed_duplicate_matches_r1 ON dismissed_duplicate_matches(request_id_1);
CREATE INDEX IF NOT EXISTS ix_dismissed_duplicate_matches_r2 ON dismissed_duplicate_matches(request_id_2);
