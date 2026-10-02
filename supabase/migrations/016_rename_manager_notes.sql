-- Align column name with admin_notes: manager-submitted notes only.

ALTER TABLE public.manager_requests
  RENAME COLUMN notes TO manager_notes;
