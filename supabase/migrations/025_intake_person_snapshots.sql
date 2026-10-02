-- Store partner vs auto-mail person snapshots for match display.

ALTER TABLE public.manager_requests
  ADD COLUMN IF NOT EXISTS intake_persons JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill partner snapshot from existing manager submissions.
UPDATE public.manager_requests mr
SET intake_persons = jsonb_build_object(
  'partner', jsonb_build_object(
    'firstName', mr.person_first_name,
    'lastName', mr.person_last_name,
    'email', mr.person_email,
    'location', mr.person_location
  )
)
WHERE (mr.intake_persons = '{}'::jsonb OR mr.intake_persons IS NULL)
  AND (
    mr.manager_id IS NOT NULL
    OR COALESCE(mr.tags, ARRAY[]::varchar[]) && ARRAY['partner req']::varchar[]
  );

-- Backfill auto-mail snapshot for PureGym intake rows.
UPDATE public.manager_requests mr
SET intake_persons = COALESCE(mr.intake_persons, '{}'::jsonb) || jsonb_build_object(
  'autoMail', jsonb_build_object(
    'firstName', mr.person_first_name,
    'lastName', mr.person_last_name,
    'email', mr.person_email,
    'location', mr.person_location
  )
)
WHERE mr.source_gmail_message_id IS NOT NULL
   OR COALESCE(mr.tags, ARRAY[]::varchar[]) && ARRAY['auto mail']::varchar[];
