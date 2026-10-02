-- Link automated roster requests to powermusic_users via person club → manager club.

UPDATE public.manager_requests mr
SET manager_id = u.id
FROM public.powermusic_users u
WHERE mr.manager_id IS NULL
  AND 'Auto email' = ANY(COALESCE(mr.tags, ARRAY[]::varchar[]))
  AND u.role = 'manager'
  AND lower(trim(u.club)) = lower(trim(mr.person_location));
