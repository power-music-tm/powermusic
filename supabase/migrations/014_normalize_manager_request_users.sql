-- Normalize manager_requests around powermusic_users FKs.
-- Manager/admin names come from powermusic_users; snapshot only for unlinked manual rows.

ALTER TABLE public.powermusic_users
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS club TEXT;

UPDATE public.powermusic_users
SET
  first_name = COALESCE(
    NULLIF(first_name, ''),
    NULLIF(split_part(COALESCE(full_name, ''), ' ', 1), '')
  ),
  last_name = COALESCE(
    NULLIF(last_name, ''),
    NULLIF(
      CASE
        WHEN position(' ' IN COALESCE(full_name, '')) > 0
          THEN trim(substring(full_name from position(' ' in full_name) + 1))
        ELSE ''
      END,
      ''
    )
  )
WHERE full_name IS NOT NULL;

UPDATE public.powermusic_users u
SET club = COALESCE(NULLIF(u.club, ''), NULLIF(trim(au.raw_user_meta_data->>'club'), ''))
FROM auth.users au
WHERE au.id = u.id;

ALTER TABLE public.manager_requests
  ADD COLUMN IF NOT EXISTS manager_snapshot JSONB;

UPDATE public.manager_requests mr
SET manager_id = u.id
FROM public.powermusic_users u
WHERE mr.manager_id IS NULL
  AND lower(trim(u.email)) = lower(trim(mr.submitted_by_email))
  AND u.role = 'manager';

UPDATE public.manager_requests mr
SET handled_by_admin_id = u.id
FROM public.powermusic_users u
WHERE mr.handled_by_admin_id IS NULL
  AND mr.status = 'handled'
  AND u.role = 'admin'
  AND (
    lower(trim(COALESCE(u.full_name, ''))) = lower(trim(COALESCE(mr.handled_by, '')))
    OR mr.handled_by = 'Power Music Admin'
  );

UPDATE public.manager_requests
SET manager_snapshot = jsonb_build_object(
  'firstName', submitted_by_first_name,
  'lastName', submitted_by_last_name,
  'email', submitted_by_email,
  'club', submitted_by_club
)
WHERE manager_id IS NULL
  AND manager_snapshot IS NULL;

ALTER TABLE public.manager_requests
  DROP COLUMN IF EXISTS submitted_by_first_name,
  DROP COLUMN IF EXISTS submitted_by_last_name,
  DROP COLUMN IF EXISTS submitted_by_email,
  DROP COLUMN IF EXISTS submitted_by_club,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS handled_by;

CREATE INDEX IF NOT EXISTS manager_requests_manager_id_idx
  ON public.manager_requests (manager_id);

CREATE INDEX IF NOT EXISTS manager_requests_handled_by_admin_id_idx
  ON public.manager_requests (handled_by_admin_id);

-- Signup trigger: persist manager profile fields on powermusic_users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_full_name TEXT;
  meta_first TEXT;
  meta_last TEXT;
  meta_club TEXT;
BEGIN
  meta_full_name := NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), '');
  meta_first := NULLIF(trim(NEW.raw_user_meta_data->>'firstName'), '');
  meta_last := NULLIF(trim(NEW.raw_user_meta_data->>'lastName'), '');
  meta_club := NULLIF(trim(NEW.raw_user_meta_data->>'club'), '');

  INSERT INTO public.powermusic_users (id, email, full_name, first_name, last_name, club, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      meta_full_name,
      NULLIF(trim(both FROM concat(meta_first, ' ', meta_last)), ''),
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(meta_first, split_part(COALESCE(meta_full_name, ''), ' ', 1)),
    COALESCE(
      meta_last,
      NULLIF(
        CASE
          WHEN position(' ' IN COALESCE(meta_full_name, '')) > 0
            THEN trim(substring(meta_full_name from position(' ' in meta_full_name) + 1))
          ELSE ''
        END,
        ''
      )
    ),
    meta_club,
    'manager'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_manager_profile()
RETURNS public.powermusic_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  auth_user RECORD;
  result public.powermusic_users;
  meta_full_name TEXT;
  meta_first TEXT;
  meta_last TEXT;
  meta_club TEXT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO result FROM public.powermusic_users WHERE id = uid;
  IF FOUND THEN
    RETURN result;
  END IF;

  SELECT id, email, raw_user_meta_data INTO auth_user
  FROM auth.users
  WHERE id = uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth user not found';
  END IF;

  meta_full_name := NULLIF(trim(auth_user.raw_user_meta_data->>'full_name'), '');
  meta_first := NULLIF(trim(auth_user.raw_user_meta_data->>'firstName'), '');
  meta_last := NULLIF(trim(auth_user.raw_user_meta_data->>'lastName'), '');
  meta_club := NULLIF(trim(auth_user.raw_user_meta_data->>'club'), '');

  INSERT INTO public.powermusic_users (id, email, full_name, first_name, last_name, club, role)
  VALUES (
    uid,
    auth_user.email,
    COALESCE(
      meta_full_name,
      NULLIF(trim(both FROM concat(meta_first, ' ', meta_last)), ''),
      split_part(auth_user.email, '@', 1)
    ),
    COALESCE(meta_first, split_part(COALESCE(meta_full_name, ''), ' ', 1)),
    COALESCE(
      meta_last,
      NULLIF(
        CASE
          WHEN position(' ' IN COALESCE(meta_full_name, '')) > 0
            THEN trim(substring(meta_full_name from position(' ' in meta_full_name) + 1))
          ELSE ''
        END,
        ''
      )
    ),
    meta_club,
    'manager'
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO result;

  IF NOT FOUND THEN
    SELECT * INTO result FROM public.powermusic_users WHERE id = uid;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not create user profile';
  END IF;

  RETURN result;
END;
$$;
