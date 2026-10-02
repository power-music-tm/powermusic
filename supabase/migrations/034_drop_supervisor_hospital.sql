-- Migration 034: Drop obsolete supervisor and hospital columns from manager_requests.
--
-- Context: The previous HealthTech implementation added supervisor and hospital
-- columns to manager_requests. The correct Health Fitness architecture reuses
-- the existing location column (stored as person_location) to represent the
-- "client" field. No separate physical column is required.
--
-- This is a FORWARD migration. Git history is preserved as required.
-- All existing data in person_first_name, person_last_name, person_email,
-- person_location, and partner_id is preserved.
--
-- supervisor and hospital columns are dropped only if they exist.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'manager_requests' AND column_name = 'supervisor'
    ) THEN
        ALTER TABLE manager_requests DROP COLUMN supervisor;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'manager_requests' AND column_name = 'hospital'
    ) THEN
        ALTER TABLE manager_requests DROP COLUMN hospital;
    END IF;
END
$$;
