-- Admin notes (added when marking handled), manager notes stay in notes column,
-- and persist when the manager originally submitted the request.

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS request_received_at TIMESTAMPTZ;

UPDATE public.people p
SET request_received_at = r.received_at
FROM public.requests r
WHERE p.source_request_id = r.id
  AND p.request_received_at IS NULL;

UPDATE public.people
SET added_by = COALESCE(handled_by, added_by)
WHERE handled_by IS NOT NULL
  AND added_by IS DISTINCT FROM handled_by;
