-- Tags are flags only (not outcome). Link automated intake to source email.

UPDATE public.manager_requests
SET tags = array_remove(array_remove(tags, 'Added'), 'Removed')
WHERE tags IS NOT NULL;

ALTER TABLE public.manager_requests
  ADD COLUMN IF NOT EXISTS source_email_id TEXT REFERENCES public.emails(id);

CREATE UNIQUE INDEX IF NOT EXISTS manager_requests_source_email_id_uidx
  ON public.manager_requests (source_email_id)
  WHERE source_email_id IS NOT NULL;
