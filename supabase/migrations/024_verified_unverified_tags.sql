-- Verified / unverified tag model for manager_requests.

UPDATE public.manager_requests mr
SET tags = (
  SELECT COALESCE(array_agg(tag ORDER BY tag), ARRAY[]::varchar[])
  FROM (
    SELECT 'already exists' AS tag
    WHERE COALESCE(mr.tags, ARRAY[]::varchar[]) && ARRAY[
      'Already Exists', 'already exists'
    ]::varchar[]
    UNION ALL
    SELECT 'auto mail'
    WHERE mr.source_gmail_message_id IS NOT NULL
       OR COALESCE(mr.tags, ARRAY[]::varchar[]) && ARRAY[
         'Auto email', 'auto mail', 'Automated email received', 'Auto Received'
       ]::varchar[]
    UNION ALL
    SELECT 'partner req'
    WHERE mr.manager_id IS NOT NULL
       OR (
         mr.source_gmail_message_id IS NULL
         AND NOT COALESCE(mr.tags, ARRAY[]::varchar[]) && ARRAY['Auto email', 'auto mail']::varchar[]
       )
    UNION ALL
    SELECT 'verified'
    WHERE mr.manager_id IS NOT NULL
       OR NOT (
         mr.source_gmail_message_id IS NOT NULL
         OR COALESCE(mr.tags, ARRAY[]::varchar[]) && ARRAY[
           'Auto email', 'auto mail', 'Automated email received', 'Auto Received'
         ]::varchar[]
       )
    UNION ALL
    SELECT 'unverified'
    WHERE (
        mr.source_gmail_message_id IS NOT NULL
        OR COALESCE(mr.tags, ARRAY[]::varchar[]) && ARRAY['Auto email', 'auto mail']::varchar[]
      )
      AND mr.manager_id IS NULL
  ) normalized
);

-- Auto-mail-only rows must not carry manager_id until a manager verifies.
UPDATE public.manager_requests
SET manager_id = NULL
WHERE 'unverified' = ANY(COALESCE(tags, ARRAY[]::varchar[]))
  AND NOT 'verified' = ANY(COALESCE(tags, ARRAY[]::varchar[]));
