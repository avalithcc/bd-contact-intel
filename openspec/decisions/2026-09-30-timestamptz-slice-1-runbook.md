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

1. **Build a preview deployment for this exact commit, by hand.**
   `vercel.json` has `git.deploymentEnabled` set to `false` for
   `feat/**`/`fix/**`/`chore/**`/`docs/**`, so pushing this branch does
   **not** create a preview on its own — a plain push-triggered preview
   will not exist to promote in step 3. From a checkout of this branch, at
   the exact commit that is about to be applied:
   ```
   npx vercel deploy --scope avalithops
   ```
   (no `--prod` — this must stay a preview build). Record the commit SHA
   and the resulting preview URL here before continuing:
   `<PASTE COMMIT SHA + PREVIEW URL HERE>`
   The preview built in this step MUST be built from the identical commit
   whose migration is applied in step 2 — never a later commit, never a
   rebuild, since step 3 promotes this exact build without recompiling.
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

   **Expected transient failure between step 2 and step 3 — not an
   incident.** Once step 2 commits, production is still running the OLD
   code (`withTimezone: false`) against the NOW-migrated `timestamptz`
   columns. Every *typed* Drizzle read of a slice-1 timestamp column hits
   `PgTimestamp.mapFromDriverValue`, which appends `+0000` to a driver
   string that already carries an offset — producing `Invalid Date`, which
   then throws a `RangeError` the moment the page tries to format it. This
   is expected for the few seconds until step 3 promotes the matching code,
   and must not be treated as an incident or rolled back on its own. Pages
   confirmed to hit this window:
   - `/admin/migration` — `migration_run.createdAt` / `approvedAt` /
     `executedAt` via `formatDateTime` (src/app/(app)/admin/migration/page.tsx)
   - `/admin/duplicates` — `merge_event.createdAt` in the merge history
     table via `formatDateTime` (src/app/(app)/admin/duplicates/page.tsx);
     `merge_event.undoneAt` is only truth-tested there (`h.undoneAt &&`),
     never formatted, so it does not throw
   - `/discovery` — `discovery_run.startedAt` via `formatDateTime`
     (src/app/(app)/discovery/page.tsx, `getLastDiscoveryRun`)
   - `/contacts/[id]` — `person_property_history.at` (the property "last
     updated by" hint) via date-fns `format`
     (src/app/(app)/contacts/[id]/page.tsx)
   - `/companies/[key]` — `company_property_history.at` (the same "last
     updated by" hint) via `formatLastEdit`
     (src/app/(app)/companies/[key]/CompanyAboutPane.tsx)

   Checked and confirmed SAFE despite rendering a slice-1 timestamp:
   `/whats-new` (Novedades) renders `sync_run.finishedAt`
   (src/lib/whatsnew/queries.ts#getSyncStatus), but that value comes from a
   raw `db.execute` and is normalized through `parseDbTimestamp`
   (src/lib/db/timestamp.ts), which trusts an already offset-bearing wire
   string as-is — so it parses correctly on both sides of the migration,
   no `Invalid Date` window.
3. **Immediately promote the SAME preview build** from step 1 to
   production, without rebuilding:
   ```
   npx vercel promote <preview-url> --scope avalithops
   ```
   The gap between step 2 and step 3 is the exact window where the DB
   column and `schema.ts`'s `withTimezone` flag can disagree (the transient
   failure above) — keep it as short as possible, and do not deploy
   anything else to production in between.
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
   production by hand, as ONE transaction — it is intentionally not wired
   into `npm run db:migrate` since it is not in the journal (see that
   file's header comment). The file itself is wrapped in `BEGIN; ...
   COMMIT;` so its `SET LOCAL lock_timeout = '2s'` applies to every ALTER
   in it, but always run it through a runner that honors (and doesn't
   fight) that transaction — never split it into individually-piped
   statements. Use one of:
   ```
   psql --single-transaction "$DATABASE_URL" -f drizzle/0028_timestamptz_slice_1_rollback.sql
   ```
   or a small postgres.js script that runs the whole file inside
   `sql.begin(async (sql) => { ... })`. Never run it with plain autocommit
   `psql -c` one statement at a time — that would strip the file's own
   `BEGIN`/`COMMIT` framing and turn each `ALTER` back into its own
   implicit transaction, exactly the non-atomic failure mode this wrapping
   exists to prevent.
3. Re-run the verification queries above and confirm `data_type` is back to
   `timestamp without time zone` with the same counts/instants.

## Owner approval

- [ ] Dry run reviewed (this document + the diff on
      `feat/timestamptz-slice-1`)
- [ ] Owner approved production execution
- [ ] `npx vercel deploy --scope avalithops` run from the exact commit;
      commit SHA + preview URL recorded above
- [ ] `npm run db:migrate` executed against production
- [ ] `npx vercel promote <preview-url> --scope avalithops` executed
      immediately after, same build, no rebuild
- [ ] Transient formatting errors on the pages listed above (if seen in
      logs during the gap) treated as expected, not paged as an incident
- [ ] Verification queries confirm the migration
