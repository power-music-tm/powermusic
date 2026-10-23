-- Admin Delete / duplicate merges no longer hard-delete manager portal requests.
-- Rows stay for the manager's request history with status:
--   'admin_deleted' — admin deleted it (manager still sees Pending / Handled as before)
--   'merged'        — folded into merged_into_request_id (manager sees Handled once that row is)
ALTER TABLE public.manager_requests
  ADD COLUMN IF NOT EXISTS merged_into_request_id TEXT;

CREATE INDEX IF NOT EXISTS ix_manager_requests_merged_into_request_id
  ON public.manager_requests (merged_into_request_id);
