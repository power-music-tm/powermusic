-- Backfill manager_id from snapshot, drop redundant manager_snapshot and request_number.

UPDATE public.manager_requests mr
SET manager_id = u.id
FROM public.powermusic_users u
WHERE mr.manager_id IS NULL
  AND mr.manager_snapshot IS NOT NULL
  AND lower(trim(u.email)) = lower(trim(mr.manager_snapshot->>'email'))
  AND u.role = 'manager';

ALTER TABLE public.manager_requests
  DROP COLUMN IF EXISTS manager_snapshot;

DROP INDEX IF EXISTS manager_requests_request_number_uidx;

ALTER TABLE public.manager_requests
  DROP COLUMN IF EXISTS request_number;
