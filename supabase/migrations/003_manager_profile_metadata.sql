-- Improve manager profile creation from signup metadata (firstName, lastName, club)

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
      NULLIF(trim(both from concat(meta_first, ' ', meta_last)), ''),
      split_part(NEW.email, '@', 1)
    ),
    'manager'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
