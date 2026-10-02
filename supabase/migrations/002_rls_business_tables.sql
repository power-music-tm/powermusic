-- Power Music Ops: RLS for business tables (defense-in-depth for PostgREST / anon key)
-- Backend FastAPI uses DATABASE_URL (postgres role) and bypasses RLS.
-- Run in Supabase SQL Editor or via: supabase db push

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_role() = 'manager';
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.template_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.draft_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.guidance_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.template_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.processing_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Admin policies
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'requests', 'people', 'activities', 'email_accounts', 'emails',
    'email_templates', 'template_translations', 'draft_edits',
    'guidance_notes', 'template_suggestions', 'processing_logs'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS admin_all ON public.%I', tbl);
      EXECUTE format(
        'CREATE POLICY admin_all ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- Manager: insert requests only (future manager-auth portal)
DROP POLICY IF EXISTS manager_insert_requests ON public.requests;
CREATE POLICY manager_insert_requests
  ON public.requests
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager());

-- ---------------------------------------------------------------------------
-- Privileges: block anon; column-scoped email_accounts (hide oauth_refresh_token)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'requests', 'people', 'activities', 'email_accounts', 'emails',
    'email_templates', 'template_translations', 'draft_edits',
    'guidance_notes', 'template_suggestions', 'processing_logs'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.email_accounts') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.email_accounts FROM authenticated;
    GRANT SELECT (
      id, email, title, status, connected_at, last_synced_at,
      backfill_status, backfill_imported_count, backfill_error, gmail_history_id
    ) ON TABLE public.email_accounts TO authenticated;
    GRANT INSERT, UPDATE, DELETE ON TABLE public.email_accounts TO authenticated;
  END IF;
END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'requests', 'people', 'activities', 'emails', 'email_templates',
    'template_translations', 'draft_edits', 'template_suggestions'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', tbl);
    END IF;
  END LOOP;
  IF to_regclass('public.guidance_notes') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.guidance_notes TO authenticated;
  END IF;
  IF to_regclass('public.processing_logs') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.processing_logs TO authenticated;
  END IF;
END $$;
