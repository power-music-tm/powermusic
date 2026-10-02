-- Persistent public request numbers (R-01, R-02, …) assigned at submission time.

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS request_number INTEGER;

UPDATE public.requests
SET request_number = NULLIF(SUBSTRING(id FROM 5), '')::INTEGER
WHERE request_number IS NULL
  AND id ~ '^req-[0-9]+$';

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY received_at ASC, id ASC) AS rn
  FROM public.requests
  WHERE request_number IS NULL
)
UPDATE public.requests r
SET request_number = numbered.rn
FROM numbered
WHERE r.id = numbered.id;

ALTER TABLE public.requests
  ALTER COLUMN request_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS requests_request_number_uidx
  ON public.requests (request_number);

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS source_request_number INTEGER;

UPDATE public.people p
SET source_request_number = r.request_number
FROM public.requests r
WHERE p.source_request_id = r.id
  AND p.source_request_number IS NULL;
