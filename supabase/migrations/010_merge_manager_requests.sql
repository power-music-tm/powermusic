-- Merge requests + people into one manager_requests table.

-- 1) request_number on requests
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS request_number INTEGER;

UPDATE public.requests
SET request_number = NULLIF(SUBSTRING(id FROM 5), '')::INTEGER
WHERE request_number IS NULL
  AND id ~ '^req-[0-9]+$';

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY received_at ASC, id ASC) AS rn
  FROM public.requests
  WHERE request_number IS NULL
)
UPDATE public.requests r
SET request_number = numbered.rn
FROM numbered
WHERE r.id = numbered.id;

-- 2) handled-side columns on requests
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS handled_by TEXT,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS handled_by_admin_id UUID REFERENCES public.profiles(id);

-- 3) people-only columns (may not exist yet)
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS manager_name TEXT,
  ADD COLUMN IF NOT EXISTS handled_by TEXT,
  ADD COLUMN IF NOT EXISTS source_request_number INTEGER,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS request_received_at TIMESTAMPTZ;

-- 4) sync linked people rows back onto their request
UPDATE public.requests r
SET
  handled_by = COALESCE(r.handled_by, p.handled_by, p.added_by),
  admin_notes = COALESCE(r.admin_notes, p.admin_notes),
  outcome = COALESCE(r.outcome, p.status),
  handled_at = COALESCE(r.handled_at, p.date_added),
  status = CASE WHEN r.status = 'new' AND p.id IS NOT NULL THEN 'handled' ELSE r.status END
FROM public.people p
WHERE p.source_request_id = r.id;

-- 5) orphan people (legacy directory rows without a request) → insert as handled requests
WITH next_num AS (
  SELECT COALESCE(MAX(request_number), 0) AS base FROM public.requests
),
orphans AS (
  SELECT
    p.*,
    ROW_NUMBER() OVER (ORDER BY p.date_added ASC, p.id ASC) AS rn
  FROM public.people p
  WHERE p.source_request_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.requests r WHERE r.id = p.source_request_id)
)
INSERT INTO public.requests (
  id, request_number, received_at, handled_at,
  submitted_by_first_name, submitted_by_last_name, submitted_by_email, submitted_by_club,
  person_first_name, person_last_name, person_email, person_location,
  action, notes, tags, created_by, status,
  handled_by, admin_notes, outcome
)
SELECT
  o.id,
  (SELECT base FROM next_num) + o.rn,
  COALESCE(o.request_received_at, o.date_added),
  o.date_added,
  COALESCE(NULLIF(split_part(COALESCE(o.manager_name, o.added_by, 'Legacy'), ' ', 1), ''), 'Legacy'),
  COALESCE(NULLIF(regexp_replace(COALESCE(o.manager_name, o.added_by, 'Legacy'), '^[^ ]+ ', ''), ''), 'Manager'),
  COALESCE(NULLIF(o.manager_email, ''), 'legacy@example.com'),
  COALESCE(NULLIF(o.club, ''), 'Legacy Club'),
  o.first_name,
  o.last_name,
  o.email,
  o.location,
  CASE WHEN o.status = 'Removed' THEN 'Remove' ELSE 'Add' END,
  o.notes,
  ARRAY[o.status]::text[],
  COALESCE(o.manager_name, o.added_by, 'Legacy'),
  'handled',
  COALESCE(o.handled_by, o.added_by, 'Power Music Admin'),
  o.admin_notes,
  o.status
FROM orphans o;

-- 6) backfill outcome on handled requests still missing it
UPDATE public.requests
SET outcome = CASE WHEN action = 'Add' THEN 'Added' ELSE 'Removed' END
WHERE status = 'handled'
  AND outcome IS NULL;

-- 7) ensure request_number NOT NULL + unique
UPDATE public.requests
SET request_number = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY received_at ASC, id ASC) AS rn
  FROM public.requests
  WHERE request_number IS NULL
) sub
WHERE public.requests.id = sub.id;

ALTER TABLE public.requests
  ALTER COLUMN request_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS requests_request_number_uidx
  ON public.requests (request_number);

-- 8) drop people — data now lives on requests
DROP TABLE IF EXISTS public.people;

-- 9) rename
ALTER TABLE public.requests RENAME TO manager_requests;

CREATE UNIQUE INDEX IF NOT EXISTS manager_requests_request_number_uidx
  ON public.manager_requests (request_number);

-- 10) RLS: replace people policies with manager_requests
ALTER TABLE public.manager_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all ON public.manager_requests;
CREATE POLICY admin_all ON public.manager_requests
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS manager_insert_requests ON public.manager_requests;
CREATE POLICY manager_insert_requests ON public.manager_requests
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager());

REVOKE ALL ON TABLE public.manager_requests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manager_requests TO authenticated;
