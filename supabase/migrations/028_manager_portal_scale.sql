-- Scale manager portal: indexes, submission job queue, shared rate-limit buckets.

CREATE INDEX IF NOT EXISTS manager_requests_manager_status_idx
  ON public.manager_requests (manager_id, status);

CREATE INDEX IF NOT EXISTS manager_requests_status_received_idx
  ON public.manager_requests (status, received_at DESC);

CREATE INDEX IF NOT EXISTS manager_requests_handled_at_idx
  ON public.manager_requests (handled_at DESC)
  WHERE status = 'handled';

CREATE INDEX IF NOT EXISTS manager_requests_added_roster_idx
  ON public.manager_requests (handled_at DESC)
  WHERE status = 'handled' AND outcome = 'Added';

CREATE INDEX IF NOT EXISTS manager_requests_person_email_lower_idx
  ON public.manager_requests (lower(person_email));

CREATE TABLE IF NOT EXISTS public.manager_submission_jobs (
  id TEXT PRIMARY KEY,
  manager_id UUID REFERENCES public.powermusic_users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS manager_submission_jobs_status_created_idx
  ON public.manager_submission_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS manager_submission_jobs_manager_id_idx
  ON public.manager_submission_jobs (manager_id);

CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets (
  rate_key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_key, window_start)
);
