-- Live updates, part 2: an email_account UPDATE broadcasts only when a BD can SEE the change.
--
-- The Gmail sync (pg_cron every 2 min) UPDATEs email_account on every run (last_synced_at, history_id, backfill token,
-- updated_at). Under 0056 each run broadcast {kind:'email_account', bdId}, and email_account is a badge kind, so every BD's
-- open tab re-rendered every ~2 minutes: polling by another name (90 of 100 broadcasts in one measured hour).
--
-- Now an UPDATE statement emits only if some row changed what the shell, the Gmail banners or /admin/gmail show:
--   status, sync_error, last_error_message, granted_scopes, email_address, connected_at, disconnected_at;
--   or last_synced_at while the old value was NULL (first success) or older than 30 minutes (recovery from the "stale" /
--   "failing" banners, whose thresholds are 60 and 30 minutes: syncHealth.ts). A routine success on a healthy account
--   (old value < 30 min old) emits nothing. INSERT and DELETE of an account always emit.
-- Everything else in the function is unchanged from 0056, and every other table behaves exactly as before. If the
-- visibility check itself fails, the statement emits (never silently drops a visible change).
--
-- Production state when this is applied: the three crm_notify_* triggers on email_account were dropped by hand (hotfix,
-- 2026-10-20), so this migration RE-CREATES them (only when missing, like 0056, so a re-run never takes ACCESS EXCLUSIVE).
-- Revert: drizzle/0058_email_account_notify_filter_rollback.sql.
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
  payload jsonb; visible boolean := true;
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'email_account' AND TG_OP = 'UPDATE' THEN
    BEGIN
      EXECUTE $v$
        SELECT EXISTS (
          SELECT 1 FROM crm_new n LEFT JOIN crm_old o ON o.bd_id = n.bd_id
          WHERE o.bd_id IS NULL
             OR n.status IS DISTINCT FROM o.status
             OR n.sync_error IS DISTINCT FROM o.sync_error
             OR n.last_error_message IS DISTINCT FROM o.last_error_message
             OR n.granted_scopes IS DISTINCT FROM o.granted_scopes
             OR n.email_address IS DISTINCT FROM o.email_address
             OR n.connected_at IS DISTINCT FROM o.connected_at
             OR n.disconnected_at IS DISTINCT FROM o.disconnected_at
             OR (n.last_synced_at IS DISTINCT FROM o.last_synced_at
                 AND (o.last_synced_at IS NULL OR o.last_synced_at < now() - interval '30 minutes')))
      $v$ INTO visible;
    EXCEPTION WHEN OTHERS THEN
      visible := true;
    END;
    IF NOT visible THEN RETURN NULL; END IF;
  END IF;
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
-- CREATE OR REPLACE keeps the owner-only EXECUTE grants of 0056; restated so a database that missed them is still closed.
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
-- email_account triggers: created only when missing (production has none after the hotfix; scratch databases still have them).
DO $do$
DECLARE op record;
BEGIN
  FOR op IN SELECT * FROM (VALUES
    ('crm_notify_ins', 'AFTER INSERT', 'REFERENCING NEW TABLE AS crm_new'),
    ('crm_notify_upd', 'AFTER UPDATE', 'REFERENCING OLD TABLE AS crm_old NEW TABLE AS crm_new'),
    ('crm_notify_del', 'AFTER DELETE', 'REFERENCING OLD TABLE AS crm_old')) AS v(name, event, refs) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.email_account'::regclass AND tgname = op.name AND NOT tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER %I %s ON public.email_account %s FOR EACH STATEMENT EXECUTE FUNCTION public.crm_notify_change()', op.name, op.event, op.refs);
    END IF;
  END LOOP;
END
$do$;
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
--> statement-breakpoint
SET LOCAL statement_timeout = DEFAULT;
