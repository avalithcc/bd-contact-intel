-- Rollback for drizzle/0059_crm_live_company_key.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Restores the 0058 body of crm_notify_change() (a
-- contact-scoped activity/task broadcasts no companyKey again, so the company record page stops refreshing live for them).
-- No trigger is touched. Also remove the journal entry (idx 59), drizzle/meta/0059_snapshot.json and the
-- drizzle.__drizzle_migrations row.
SET LOCAL lock_timeout = '3s';
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
