-- Let the sign-in form check whether a manager account exists (before password login).
CREATE OR REPLACE FUNCTION public.manager_account_exists(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(trim(email)) = lower(trim(p_email))
      AND role = 'manager'
  );
$$;

REVOKE ALL ON FUNCTION public.manager_account_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_account_exists(text) TO anon, authenticated;
