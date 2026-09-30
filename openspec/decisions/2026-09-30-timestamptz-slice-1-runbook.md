# Runbook — timestamptz migration, slice 1

Prepared 2026-09-30 on branch `feat/timestamptz-slice-1`. Planning only —
nothing has been applied to production. Read
`openspec/decisions/2026-09-30-timestamptz-migration-plan.md` first,
especially "The non-obvious risk: Drizzle's timestamp parser" — this runbook
exists to enforce that exact sequence for slice 1.

Scope: `bd`, `company_category`, `target_company`, `company_alias`,
`sync_run`, `discovery_run`, `company_probe`, `email_domain_check`,
`lead_source`, `board_candidate`, `person_property_history`,
`person_id_map`, `merge_event`, `duplicate_candidate`, `audit_log`,
`migration_run`, `saved_view`, `company_property_history`, `signal`,
`linkedin_scrape_job`, `email_never_log`, `task_digest_send` — 34 columns,
34 rows returned by prod's `information_schema.columns` for these tables
today; all small/low-traffic (largest expected row counts are in the low
thousands).

## Files this runbook uses

- Forward migration (in the drizzle journal, `drizzle/meta/_journal.json`
  idx 28): `drizzle/0028_timestamptz_slice_1.sql`
- Rollback (deliberately NOT in the journal — see that file's header
  comment): `drizzle/0028_timestamptz_slice_1_rollback.sql`

## Required sequence (do not reorder)

1. **Deploy this branch's code to a preview only.** Do not promote yet.
   Record the preview deploy URL here before continuing:
   `<PASTE PREVIEW URL HERE>`
2. **Apply the migration to production** by hand:
   ```
   npm run db:migrate
   ```
   This runs every pending journal entry inside one transaction
   (`drizzle-kit migrate`) — confirm no other slice's migration is pending
   before running this (`git log -- drizzle/meta/_journal.json` on the
   deployed branch, or check `drizzle`'s applied-migrations table in prod).
   `SET LOCAL lock_timeout = '2s'` is the first statement in
   `0028_timestamptz_slice_1.sql`, so a blocked `ALTER` aborts the whole
   transaction within 2 seconds instead of queuing and starving the
   3-connection production pool.
3. **Immediately promote the SAME preview build** from step 1 to
   production, without rebuilding:
   ```
   vercel promote <preview-url>
   ```
   The gap between step 2 and step 3 is the exact window where the DB
   column and `schema.ts`'s `withTimezone` flag can disagree — keep it as
   short as possible, and do not deploy anything else to production in
   between.
4. **Run the verification queries** below against production and confirm
   the counts/instants match what was recorded before step 2.

## Verification queries (run before step 2 AND after step 3)

Run once per table in scope. Example for `audit_log`; substitute the table
name for the other 21:

```sql
select column_name, data_type from information_schema.columns where table_name = 'audit_log';
select count(*) from audit_log;
select id, at from audit_log order by at desc nulls last limit 20;  -- same instants before and after
select indexname from pg_indexes where tablename = 'audit_log';
```

Expected diff after step 3: `data_type` changes from
`timestamp without time zone` to `timestamp with time zone` for every
affected column; `count(*)`, the returned instants, and the index list are
otherwise unchanged.

## If verification fails, or step 3 cannot happen immediately after step 2

Roll back in this order (per the plan's "Rollback" note — forward-only,
never edit an applied migration):

1. Redeploy the previous production code (the commit before this branch, so
   `schema.ts` has `withTimezone: false` for these columns again) FIRST.
2. Only then apply `drizzle/0028_timestamptz_slice_1_rollback.sql` to
   production by hand (`psql` or the same runner used for `db:migrate`,
   pointed at that file directly — it is intentionally not wired into
   `npm run db:migrate` since it is not in the journal).
3. Re-run the verification queries above and confirm `data_type` is back to
   `timestamp without time zone` with the same counts/instants.

## Owner approval

- [ ] Dry run reviewed (this document + the diff on
      `feat/timestamptz-slice-1`)
- [ ] Owner approved production execution
- [ ] Preview deploy URL recorded above
- [ ] `npm run db:migrate` executed against production
- [ ] `vercel promote` executed immediately after
- [ ] Verification queries confirm the migration
