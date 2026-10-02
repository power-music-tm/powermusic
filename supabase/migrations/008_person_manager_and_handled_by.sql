-- Separate submitting manager from the admin who marked the request handled.

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS manager_name TEXT,
  ADD COLUMN IF NOT EXISTS handled_by TEXT;

UPDATE public.people
SET manager_name = COALESCE(manager_name, added_by),
    handled_by = COALESCE(handled_by, 'Power Music Admin')
WHERE manager_name IS NULL OR handled_by IS NULL;
