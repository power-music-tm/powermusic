-- Populate manager_requests from legacy requests + people, then drop old tables.

INSERT INTO public.manager_requests (
  id, request_number, received_at, handled_at,
  submitted_by_first_name, submitted_by_last_name, submitted_by_email, submitted_by_club,
  person_first_name, person_last_name, person_email, person_location,
  action, notes, admin_notes, tags, created_by, handled_by, status, outcome
)
SELECT
  r.id,
  COALESCE(
    NULLIF(SUBSTRING(r.id FROM 5), '')::INTEGER,
    ROW_NUMBER() OVER (ORDER BY r.received_at ASC, r.id ASC)
  ),
  r.received_at,
  COALESCE(r.handled_at, p.date_added),
  r.submitted_by_first_name,
  r.submitted_by_last_name,
  r.submitted_by_email,
  r.submitted_by_club,
  r.person_first_name,
  r.person_last_name,
  r.person_email,
  r.person_location,
  r.action,
  r.notes,
  NULL::text AS admin_notes,
  r.tags,
  r.created_by,
  'Power Music Admin' AS handled_by,
  r.status,
  COALESCE(p.status, CASE WHEN r.status = 'handled' THEN CASE WHEN r.action = 'Add' THEN 'Added' ELSE 'Removed' END END)
FROM public.requests r
LEFT JOIN public.people p ON p.source_request_id = r.id
ON CONFLICT (id) DO NOTHING;

-- Orphan people without a request row
WITH next_num AS (
  SELECT COALESCE(MAX(request_number), 0) AS base FROM public.manager_requests
),
orphans AS (
  SELECT
    p.*,
    ROW_NUMBER() OVER (ORDER BY p.date_added ASC, p.id ASC) AS rn
  FROM public.people p
  WHERE p.source_request_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.manager_requests m WHERE m.id = p.source_request_id)
)
INSERT INTO public.manager_requests (
  id, request_number, received_at, handled_at,
  submitted_by_first_name, submitted_by_last_name, submitted_by_email, submitted_by_club,
  person_first_name, person_last_name, person_email, person_location,
  action, notes, admin_notes, tags, created_by, handled_by, status, outcome
)
SELECT
  o.id,
  (SELECT base FROM next_num) + o.rn,
  COALESCE(o.date_added, NOW()),
  o.date_added,
  COALESCE(NULLIF(split_part(COALESCE(o.added_by, 'Legacy Manager'), ' ', 1), ''), 'Legacy'),
  COALESCE(NULLIF(regexp_replace(COALESCE(o.added_by, 'Legacy Manager'), '^[^ ]+ ', ''), ''), 'Manager'),
  COALESCE(NULLIF(o.manager_email, ''), 'legacy@example.com'),
  COALESCE(NULLIF(o.club, ''), 'Legacy Club'),
  o.first_name,
  o.last_name,
  o.email,
  o.location,
  CASE WHEN o.status = 'Removed' THEN 'Remove' ELSE 'Add' END,
  o.notes,
  NULL,
  ARRAY[o.status]::text[],
  COALESCE(o.added_by, 'Legacy'),
  COALESCE(o.added_by, 'Power Music Admin'),
  'handled',
  o.status
FROM orphans o
ON CONFLICT (id) DO NOTHING;

UPDATE public.manager_requests
SET outcome = CASE WHEN action = 'Add' THEN 'Added' ELSE 'Removed' END
WHERE status = 'handled' AND outcome IS NULL;

DROP TABLE IF EXISTS public.people;
DROP TABLE IF EXISTS public.requests;
