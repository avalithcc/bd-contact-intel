# Plan — convert every naive `timestamp` column to `timestamptz`

Prepared 2026-09-30. Planning only; nothing applied. This is the durable fix for the timezone skew noted in `openspec/BACKLOG.md` (task-essentials).

## Summary

| | |
| --- | --- |
| Scope | 70 `timestamp without time zone` columns in 33 of 34 tables (`src/db/schema.ts`). All of them hold UTC. |
| SQL | `ALTER TABLE t ALTER COLUMN c TYPE timestamptz USING c AT TIME ZONE 'UTC'`. Values do not change, and the conversion is exactly reversible. |
| Cost | Rewrites the whole table and its indexes under an `ACCESS EXCLUSIVE` lock. Tables are small (person ~26k, company ~14k), so this is estimated at seconds per table. That is an estimate, not a measurement. |
| Biggest risk | **The deploy order.** The DB column and the `withTimezone` flag in `schema.ts` must change together, with no window where they disagree (see below). |
| Plan | 7 slices, each applied by its own `drizzle-kit migrate` run, at low-traffic times. |

## The non-obvious risk: Drizzle's timestamp parser

- The Drizzle postgres-js driver replaces the client's parsers for OIDs 1114/1184 with a passthrough (`node_modules/drizzle-orm/postgres-js/driver.js:16-20`), so raw wire strings reach Drizzle's column mapper unmodified.
- `PgTimestamp.mapFromDriverValue` runs `new Date(withTimezone ? value : value + "+0000")`.
- If a column becomes `timestamptz` while the deployed schema still says `withTimezone: false`, Drizzle appends `+0000` to a string that already ends in `+00`. The result is **`Invalid Date` on every typed read of that table**.
- The opposite mismatch (new code, old column) parses offset-less strings in the process timezone. That is wrong on any non-UTC runtime.

**Required sequence for each slice:**
1. Deploy the code with `withTimezone: true` for that slice's columns to a **preview** only.
2. Apply the slice's migration to production by hand.
3. Immediately **promote that same preview** build to production, without rebuilding.
4. Run the verification queries below.

`drizzle-kit migrate` applies every pending file inside **one transaction** (`drizzle-orm/pg-core/dialect.js:44-69`), so the locks accumulate until commit. Never let several slices be pending at once. Add `SET LOCAL lock_timeout = '2s'` so that a blocked ALTER aborts instead of exhausting the 3-connection production pool.

## Code impact

- `schema.ts`: add `{ withTimezone: true }` to every column, slice by slice. Writes are unaffected, because Drizzle always sends `toISOString()`.
- `src/lib/hiring/discovery.ts:148`: change `::timestamp` to `::timestamptz`. Today it depends on the session TimeZone, so fix it first.
- The raw SQL already casts to `::timestamptz` (effectiveActivityAtSql, workedTodayAtSql, the badge counts, the list staleness filter). It keeps working, and it stops relying on implicit CASE type unification.
- `parseDbTimestamp` stays as a harmless passthrough, because every raw string will already carry an offset. Update its doc comment afterwards.
- `task.due_at` also becomes `timestamptz` here. Moving it to a `date` column is a separate follow-up and should not be bundled.
- The pg_cron job (only an HTTP call) and the Vercel digest cron are unaffected.

## Slices

0. **Prep, no migration:** the discovery.ts cast fix, plus a `parseDbTimestamp` test for offset-bearing wire strings.
1. **Small, low-traffic tables:** bd, company_category, target_company, company_alias, sync_run, discovery_run, company_probe, email_domain_check, lead_source, board_candidate, person_property_history, person_id_map, merge_event, duplicate_candidate, audit_log, migration_run, saved_view, company_property_history, signal, linkedin_scrape_job, email_never_log, task_digest_send.
2. **Imported tables:** job_posting, contact, conversation, message.
3. lead, person.
4. company.
5. activity, task.
6. email_account, email_message, follow_up_queue_item, person_bd_connection.

**Rollback (per slice, forward-only; never edit an applied migration):** redeploy the previous code first, then apply `ALTER COLUMN c TYPE timestamp USING c AT TIME ZONE 'UTC'`.

## Verification (read-only, before and after each slice)

```sql
select column_name, data_type from information_schema.columns where table_name = '<table>';
select count(*) from <table>;
select id, created_at from <table> order by created_at desc nulls last limit 20;  -- same instants before and after
select indexname from pg_indexes where tablename = '<table>';
```
