-- Treat any auth.users row as an existing account (covers magic-link signups, missing profile rows).
CREATE OR REPLACE FUNCTION public.manager_account_exists(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(trim(email)) = lower(trim(p_email))
  );
$$;

REVOKE ALL ON FUNCTION public.manager_account_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_account_exists(text) TO anon, authenticated;
