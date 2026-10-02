-- Drop redundant user_roles (roles live on powermusic_users.role).
-- Rename profiles → powermusic_users.

DROP TABLE IF EXISTS public.user_roles;

-- Remove empty stub if a prior partial migration created it
DROP TABLE IF EXISTS public.powermusic_users;

ALTER TABLE public.profiles RENAME TO powermusic_users;

ALTER INDEX IF EXISTS profiles_pkey RENAME TO powermusic_users_pkey;
ALTER INDEX IF EXISTS profiles_role_idx RENAME TO powermusic_users_role_idx;
ALTER INDEX IF EXISTS profiles_single_admin_idx RENAME TO powermusic_users_single_admin_idx;

ALTER TABLE public.manager_requests
  DROP CONSTRAINT IF EXISTS requests_manager_id_fkey,
  DROP CONSTRAINT IF EXISTS requests_handled_by_admin_id_fkey,
  DROP CONSTRAINT IF EXISTS manager_requests_manager_id_fkey,
  DROP CONSTRAINT IF EXISTS manager_requests_handled_by_admin_id_fkey;

ALTER TABLE public.manager_requests
  ADD CONSTRAINT manager_requests_manager_id_fkey
    FOREIGN KEY (manager_id) REFERENCES public.powermusic_users(id),
  ADD CONSTRAINT manager_requests_handled_by_admin_id_fkey
    FOREIGN KEY (handled_by_admin_id) REFERENCES public.powermusic_users(id);

-- RLS helper used by business-table policies
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.powermusic_users WHERE id = auth.uid();
$$;

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
BEGIN
  meta_full_name := NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), '');
  meta_first := NULLIF(trim(NEW.raw_user_meta_data->>'firstName'), '');
  meta_last := NULLIF(trim(NEW.raw_user_meta_data->>'lastName'), '');

  INSERT INTO public.powermusic_users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      meta_full_name,
      NULLIF(trim(both FROM concat(meta_first, ' ', meta_last)), ''),
      split_part(NEW.email, '@', 1)
    ),
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

  INSERT INTO public.powermusic_users (id, email, full_name, role)
  VALUES (
    uid,
    auth_user.email,
    COALESCE(
      meta_full_name,
      NULLIF(trim(both FROM concat(meta_first, ' ', meta_last)), ''),
      split_part(auth_user.email, '@', 1)
    ),
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

DROP POLICY IF EXISTS "Users can read own profile" ON public.powermusic_users;
CREATE POLICY "Users can read own profile"
  ON public.powermusic_users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users cannot update profiles" ON public.powermusic_users;
CREATE POLICY "Users cannot update profiles"
  ON public.powermusic_users
  FOR UPDATE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "Users cannot insert profiles" ON public.powermusic_users;
CREATE POLICY "Users cannot insert profiles"
  ON public.powermusic_users
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.powermusic_users;
DROP TRIGGER IF EXISTS powermusic_users_set_updated_at ON public.powermusic_users;
CREATE TRIGGER powermusic_users_set_updated_at
  BEFORE UPDATE ON public.powermusic_users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON TABLE public.powermusic_users TO authenticated;
