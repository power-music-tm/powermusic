-- Rename Pilot 2 inbox registry table for clarity.

DO $$
BEGIN
  IF to_regclass('public.email_accounts') IS NOT NULL THEN
    IF to_regclass('public.connected_emails') IS NOT NULL THEN
      IF (SELECT count(*)::int FROM public.connected_emails) = 0 THEN
        DROP TABLE public.connected_emails;
      ELSE
        RAISE EXCEPTION 'connected_emails already has rows; merge manually before rename';
      END IF;
    END IF;
    ALTER TABLE public.email_accounts RENAME TO connected_emails;
  END IF;
END $$;

-- RLS policy admin_all moves with the table rename; re-apply column-scoped grants.
DO $$
BEGIN
  IF to_regclass('public.connected_emails') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.connected_emails FROM authenticated;
    GRANT SELECT (
      id, email, title, status, connected_at, last_synced_at,
      backfill_status, backfill_imported_count, backfill_error, gmail_history_id
    ) ON TABLE public.connected_emails TO authenticated;
    GRANT INSERT, UPDATE, DELETE ON TABLE public.connected_emails TO authenticated;
  END IF;
END $$;
