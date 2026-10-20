-- Push invalidation for the app shell (replaces the 60 s background polling). Every write to a table that feeds a screen
-- emits ONE minimal Realtime broadcast per statement on the private 'crm' topic: {kind, op, ids, bdId?} or, past 50
-- distinct ids, {kind, op, bulk, count}. Never row data. The browser answers by re-fetching the screen if it is affected.
--
-- Safe everywhere: the trigger function is a no-op while realtime.send does not exist (local scratch databases), and any
-- failure inside it is swallowed, so a notification can never fail or roll back a write. Transition tables (one message
-- per statement, not per row) allow a single event per trigger, hence one trigger per operation.
--
-- Deliberately NOT notified: email_message / email_message_person (raw Gmail sync rows; the sync's activities and
-- email_account.last_synced_at already cover every screen), *_property_history and audit_log (history of rows that are
-- notified themselves), sequence_send_claim and the cron digest tables (internal bookkeeping), sync_run.
-- Fail fast instead of queueing a lock behind a long sync or import transaction (a queued lock request blocks every later
-- reader and writer of the table). CREATE TRIGGER takes SHARE ROW EXCLUSIVE; triggers that already exist are not touched.
SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.crm_notify_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  cap constant int := 50;
  cols text; joins text := ''; src text; q text; sel text := '';
  n bigint; a_p text[]; a_c text[]; a_s text[]; a_m text[]; a_t text[]; a_e text[]; a_b text[];
  payload jsonb;
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN NULL; END IF;
  -- Columns, in order: person id, company key, sequence id, meeting id, task id, scheduled email id, bd id.
  cols := CASE TG_TABLE_NAME
    WHEN 'activity' THEN 'r.person_id::text, r.company_key, NULL, NULL, NULL, NULL, r.actor_bd_id::text'
    WHEN 'task' THEN 'r.person_id::text, r.company_key, NULL, NULL, r.id::text, NULL, r.assigned_to_bd_id::text'
    WHEN 'meeting' THEN 'r.person_id::text, NULL, NULL, r.id::text, NULL, NULL, r.bd_id::text'
    WHEN 'scheduled_email' THEN 'r.person_id::text, NULL, NULL, NULL, NULL, r.id::text, r.bd_id::text'
    WHEN 'sequence' THEN 'NULL, NULL, r.id::text, NULL, NULL, NULL, r.owner_bd_id::text'
    WHEN 'sequence_member' THEN 'r.person_id::text, NULL, r.sequence_id::text, NULL, NULL, NULL, NULL'
    WHEN 'sequence_draft' THEN 'm.person_id::text, NULL, m.sequence_id::text, NULL, NULL, NULL, NULL'
    WHEN 'follow_up_queue_item' THEN 'r.person_id::text, NULL, NULL, NULL, NULL, NULL, r.bd_id::text'
    WHEN 'person' THEN 'r.id::text, r.company_key, NULL, NULL, NULL, NULL, r.owner_bd_id::text'
    WHEN 'company' THEN 'NULL, r.company_key, NULL, NULL, NULL, NULL, r.owner_bd_id::text'
    WHEN 'email_account' THEN 'NULL, NULL, NULL, NULL, NULL, NULL, r.bd_id::text'
  END;
  IF cols IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'sequence_draft' THEN joins := ' LEFT JOIN public.sequence_member m ON m.id = r.sequence_member_id'; END IF;
  src := CASE TG_OP WHEN 'INSERT' THEN 'crm_new' WHEN 'DELETE' THEN 'crm_old'
    ELSE '(SELECT * FROM crm_old UNION ALL SELECT * FROM crm_new)' END;
  FOR i IN 1..7 LOOP
    sel := sel || format(', (SELECT array_agg(v) FROM (SELECT DISTINCT c%s AS v FROM s WHERE c%s IS NOT NULL LIMIT %s) t)', i, i, cap + 1);
  END LOOP;
  q := format('WITH s(c1, c2, c3, c4, c5, c6, c7) AS (SELECT %s FROM %s r%s) SELECT (SELECT count(*) FROM s)%s', cols, src, joins, sel);
  BEGIN
    EXECUTE q INTO n, a_p, a_c, a_s, a_m, a_t, a_e, a_b;
    IF n = 0 THEN RETURN NULL; END IF;
    IF greatest(coalesce(cardinality(a_p), 0), coalesce(cardinality(a_c), 0), coalesce(cardinality(a_s), 0),
                coalesce(cardinality(a_m), 0), coalesce(cardinality(a_t), 0), coalesce(cardinality(a_e), 0)) > cap THEN
      payload := jsonb_build_object('kind', TG_TABLE_NAME, 'op', TG_OP, 'bulk', true, 'count', n);
    ELSE
      payload := jsonb_build_object('kind', TG_TABLE_NAME, 'op', TG_OP, 'ids', jsonb_strip_nulls(jsonb_build_object(
        'personId', to_jsonb(a_p), 'companyKey', to_jsonb(a_c), 'sequenceId', to_jsonb(a_s),
        'meetingId', to_jsonb(a_m), 'taskId', to_jsonb(a_t), 'scheduledEmailId', to_jsonb(a_e))));
      IF cardinality(a_b) = 1 THEN payload := payload || jsonb_build_object('bdId', a_b[1]); END IF;
    END IF;
    PERFORM realtime.send(payload, 'change', 'crm', true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint
-- Only the owner (and the trigger machinery) may run it: Supabase grants EXECUTE on new public functions to the API roles.
DO $do$
DECLARE r text;
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.crm_notify_change() FROM PUBLIC';
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.crm_notify_change() FROM %I', r);
    END IF;
  END LOOP;
END
$do$;
--> statement-breakpoint
DO $do$
DECLARE t text; op record;
BEGIN
  FOREACH t IN ARRAY ARRAY['activity','task','meeting','scheduled_email','sequence','sequence_member','sequence_draft',
                           'follow_up_queue_item','person','company','email_account'] LOOP
    FOR op IN SELECT * FROM (VALUES
      ('crm_notify_ins', 'AFTER INSERT', 'REFERENCING NEW TABLE AS crm_new'),
      ('crm_notify_upd', 'AFTER UPDATE', 'REFERENCING OLD TABLE AS crm_old NEW TABLE AS crm_new'),
      ('crm_notify_del', 'AFTER DELETE', 'REFERENCING OLD TABLE AS crm_old')) AS v(name, event, refs) LOOP
      -- Created only when missing: a re-run never drops (ACCESS EXCLUSIVE) a live trigger.
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', t)::regclass AND tgname = op.name AND NOT tgisinternal) THEN
        EXECUTE format('CREATE TRIGGER %I %s ON public.%I %s FOR EACH STATEMENT EXECUTE FUNCTION public.crm_notify_change()', op.name, op.event, t, op.refs);
      END IF;
    END LOOP;
  END LOOP;
END
$do$;
--> statement-breakpoint
-- Realtime Authorization: only a signed-in BD (allowed work domain, confirmed email, not banned or deleted: the rules of
-- getCurrentBd and the middleware) may RECEIVE on the 'crm' topic. No INSERT policy, so the browser cannot broadcast.
-- Skipped where Supabase's realtime/auth schemas do not exist (local scratch databases).
DO $do$
DECLARE r text;
BEGIN
  IF to_regclass('realtime.messages') IS NULL OR to_regclass('auth.users') IS NULL THEN RETURN; END IF;
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.crm_live_allowed() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $body$
      SELECT EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
          AND (u.banned_until IS NULL OR u.banned_until < now())
          AND lower(btrim(u.email)) ~ '^[^@]+@avalith\.net$')
    $body$
  $f$;
  -- Policy expressions run with the querying role's privileges, so only `authenticated` keeps EXECUTE.
  EXECUTE 'REVOKE ALL ON FUNCTION public.crm_live_allowed() FROM PUBLIC';
  FOREACH r IN ARRAY ARRAY['anon', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.crm_live_allowed() FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.crm_live_allowed() TO authenticated';
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS crm_live_receive ON realtime.messages';
  EXECUTE $p$
    CREATE POLICY crm_live_receive ON realtime.messages FOR SELECT TO authenticated
    USING (realtime.topic() = 'crm' AND extension = 'broadcast' AND (SELECT public.crm_live_allowed()))
  $p$;
END
$do$;
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
--> statement-breakpoint
SET LOCAL statement_timeout = DEFAULT;
