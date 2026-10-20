-- Rollback for drizzle/0056_crm_live_updates.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Removes the policy, the triggers and both
-- functions; no data was written by the migration. Also remove the journal entry (idx 56), drizzle/meta/0056_snapshot.json
-- and the drizzle.__drizzle_migrations row. The app keeps working without live updates (the client falls back silently).
DO $do$
DECLARE t text;
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS crm_live_receive ON realtime.messages';
  END IF;
  FOREACH t IN ARRAY ARRAY['activity','task','meeting','scheduled_email','sequence','sequence_member','sequence_draft',
                           'follow_up_queue_item','person','company','email_account'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS crm_notify_ins ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS crm_notify_upd ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS crm_notify_del ON public.%I', t);
  END LOOP;
END
$do$;
DROP FUNCTION IF EXISTS public.crm_live_allowed();
DROP FUNCTION IF EXISTS public.crm_notify_change();
