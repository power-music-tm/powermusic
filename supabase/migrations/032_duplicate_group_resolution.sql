-- Migration 032: Duplicate Group Resolution — audit column
-- Adds resolution_metadata JSONB to duplicate_groups to store a compact before/after
-- audit snapshot at resolve time (resolution_type, final_values, previous_values, admin_note).
-- Safe against existing rows: nullable column, no backfill required.

ALTER TABLE duplicate_groups
ADD COLUMN IF NOT EXISTS resolution_metadata JSONB;
