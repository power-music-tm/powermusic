-- Track when managers have seen handled requests (server-backed unread state).

CREATE TABLE IF NOT EXISTS public.manager_request_views (
  manager_id UUID NOT NULL REFERENCES public.powermusic_users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES public.manager_requests(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (manager_id, request_id)
);

CREATE INDEX IF NOT EXISTS manager_request_views_manager_id_idx
  ON public.manager_request_views (manager_id);

ALTER TABLE public.manager_request_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manager_own_views ON public.manager_request_views;
CREATE POLICY manager_own_views ON public.manager_request_views
  FOR ALL
  USING (manager_id = auth.uid())
  WITH CHECK (manager_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manager_request_views TO authenticated;
