-- Fallback when handle_new_user trigger did not run (migration not applied or legacy users).
-- Callable by authenticated users to create their own manager profile row.

CREATE OR REPLACE FUNCTION public.ensure_manager_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  auth_user RECORD;
  result public.profiles;
  meta_full_name TEXT;
  meta_first TEXT;
  meta_last TEXT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO result FROM public.profiles WHERE id = uid;
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

  INSERT INTO public.profiles (id, email, full_name, role)
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
    SELECT * INTO result FROM public.profiles WHERE id = uid;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not create profile';
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_manager_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_manager_profile() TO authenticated;

-- Ensure signup trigger exists (idempotent).
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

  INSERT INTO public.profiles (id, email, full_name, role)
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
