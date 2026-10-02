-- Speed up manager portal reads (requests list, directory search, roster checks).

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
