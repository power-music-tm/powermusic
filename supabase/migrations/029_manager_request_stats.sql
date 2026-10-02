-- Fast manager portal summary: store counts on the user row.

ALTER TABLE public.powermusic_users
  ADD COLUMN IF NOT EXISTS manager_request_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manager_request_pending INTEGER NOT NULL DEFAULT 0;

UPDATE public.powermusic_users u
SET
  manager_request_total = stats.total,
  manager_request_pending = stats.pending
FROM (
  SELECT
    manager_id,
    COUNT(*)::INTEGER AS total,
    COUNT(*) FILTER (WHERE status = 'new')::INTEGER AS pending
  FROM public.manager_requests
  WHERE manager_id IS NOT NULL
    AND 'verified' = ANY(tags)
  GROUP BY manager_id
) AS stats
WHERE u.id = stats.manager_id;
