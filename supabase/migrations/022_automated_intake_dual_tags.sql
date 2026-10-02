-- Automated intake: two short tags — partner/manager request + auto email source.

UPDATE public.manager_requests
SET tags = (
  SELECT ARRAY(
    SELECT DISTINCT tag::varchar
    FROM (
      SELECT unnest(
        array_remove(
          array_remove(
            array_remove(COALESCE(tags, ARRAY[]::varchar[]), 'Automated email received'),
            'Auto Received'
          ),
          'Mgr + Auto Email'
        )
      ) AS tag
      UNION ALL
      SELECT 'Partner req'
      UNION ALL
      SELECT 'Auto email'
    ) normalized
    ORDER BY tag
  )::varchar[]
)
WHERE COALESCE(tags, ARRAY[]::varchar[]) && ARRAY[
  'Automated email received',
  'Auto Received',
  'Mgr + Auto Email',
  'Auto email',
  'Partner req'
]::varchar[];
