-- Shorten automated intake tag label on existing requests.

UPDATE public.manager_requests
SET tags = array_replace(tags, 'Automated email received', 'Auto Received')
WHERE tags IS NOT NULL
  AND 'Automated email received' = ANY(tags);
