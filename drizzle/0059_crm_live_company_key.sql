-- Live updates, part 3: a CONTACT-scoped activity or task now broadcasts the CANONICAL company key of its person.
--
-- Bug: crm_notify_change() emitted r.company_key for activity and task, but a contact-scoped row has company_key NULL and
-- only person_id. The payload is built with jsonb_strip_nulls, so companyKey vanished and the company record page (which
-- subscribes with scope companyKey = <canonical key>, liveRelevance.ts) never refreshed when a contact's activity changed.
--
-- Now: coalesce(r.company_key, <person's canonical key>). getCompanyByKey matches company.company_key exactly (no alias
-- step), so the page exists only at the canonical key; the person's raw key is wrong when it is an alias. Resolution, as in
-- getCanonicalCompanyKeyForPerson: a key that is a live company resolves to itself even if a company_alias row names it,
-- else a real alias resolves to its company, else NULL (no companyKey, exactly the old behaviour).
-- Cost: coalesce short-circuits, so company-scoped rows pay nothing; person-scoped rows pay 2-3 primary-key probes.
-- Only the body of crm_notify_change() changes (on top of 0058); every other table and the email_account filter behave as
-- before. No trigger is created or dropped. Revert: drizzle/0059_crm_live_company_key_rollback.sql.
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
  -- The CANONICAL company key of the row's person: a key that is itself a live company resolves to itself (even when a
  -- company_alias row also names it), otherwise a real alias resolves to its company, otherwise NULL. Same rule as
  -- getCanonicalCompanyKeyForPerson (aliasResolutionDb.ts) and the key rule of companyContactsCondition (aliasRule.ts).
  -- Primary-key probes only: person.id, company.company_key, company_alias.alias_key. NULL-safe: person_id NULL, a missing
  -- person row (e.g. a DELETE whose person is already gone) and a person without a company key all yield NULL.
  person_ck constant text :=
    '(SELECT coalesce(' ||
      '(SELECT c.company_key FROM public.company c WHERE c.company_key = p.company_key), ' ||
      '(SELECT a.company_key FROM public.company_alias a WHERE a.alias_key = p.company_key ' ||
        'AND NOT EXISTS (SELECT 1 FROM public.company c2 WHERE c2.company_key = a.alias_key))) ' ||
    'FROM public.person p WHERE p.id = r.person_id)';
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
  -- activity and task: a CONTACT-scoped row has company_key NULL and carries only person_id, so jsonb_strip_nulls would
  -- drop companyKey and the company record page (scoped by companyKey) never refreshed. coalesce short-circuits: a
  -- company-scoped row (company_key set) never evaluates person_ck; only person-scoped rows pay the lookup.
  cols := CASE TG_TABLE_NAME
    WHEN 'activity' THEN 'r.person_id::text, coalesce(r.company_key, ' || person_ck || '), NULL, NULL, NULL, NULL, r.actor_bd_id::text'
    WHEN 'task' THEN 'r.person_id::text, coalesce(r.company_key, ' || person_ck || '), NULL, NULL, r.id::text, NULL, r.assigned_to_bd_id::text'
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
SET LOCAL lock_timeout = DEFAULT;
--> statement-breakpoint
SET LOCAL statement_timeout = DEFAULT;
