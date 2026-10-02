-- Idempotent automated roster intake without persisting an emails row.

ALTER TABLE public.manager_requests
  ADD COLUMN IF NOT EXISTS source_gmail_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS manager_requests_source_gmail_message_id_uidx
  ON public.manager_requests (source_gmail_message_id)
  WHERE source_gmail_message_id IS NOT NULL;
