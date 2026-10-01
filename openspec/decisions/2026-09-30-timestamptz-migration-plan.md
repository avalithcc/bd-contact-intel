# Plan — convert every naive `timestamp` column to `timestamptz`

Prepared 2026-09-30. **Status 2026-10-01: complete once slice 6 is applied** (slices 1-5 are applied and verified in production; slice 6 is prepared in `2026-10-01-timestamptz-slice-6-runbook.md`). See "Completion record" at the end. This is the durable fix for the timezone skew noted in `openspec/BACKLOG.md` (task-essentials).

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

**Required sequence for each slice, revised after slice 1 (2026-09-30):**

Slice 1 shipped with the preview-then-promote sequence below, and two things
turned out to be wrong about it. First, `vercel promote <preview-url>` does
NOT swap an already-built deployment instantly — it builds a new production
deployment, which took ~90 seconds in practice, so the real code/schema
mismatch window was ~100 seconds, not the "few seconds" this plan assumed.
It was harmless only because it ran at low-traffic hours. Second, and more
importantly, the "opposite mismatch" this plan already flagged below (new
code, old column) was measured directly against production rather than just
reasoned about:

```
columna real:          timestamp without time zone
valor crudo:           2026-09-30 09:42:27.365516
withTimezone: false -> 2026-09-30T09:42:27.365Z
withTimezone: true  -> 2026-09-30T09:42:27.365Z   (identical)
```

On Vercel prod (`TZ=UTC`), `PgTimestamp.mapFromDriverValue`'s "parse the
offset-less string in the process timezone" branch is a no-op, because the
process timezone already IS UTC. So new-code-against-old-column is
**harmless** on this platform; only old-code-against-new-column (appending
`+0000` to a string that already has an offset) breaks.

**That asymmetry means the correct sequence has NO broken window at all, and
needs no preview/promote dance:**

1. Merge the code with `withTimezone: true` for that slice's columns to
   `main`. The production deploy builds from it. Wait for the deployment to
   reach **Ready**.
2. Apply the slice's migration to production by hand.
3. Run the verification queries below.

This order is deliberately **inverted from the original plan**: code ships
first, migration second — never the other way around, and never with a
preview build that has to be promoted. This holds starting with slice 2; see
`openspec/decisions/2026-09-30-timestamptz-slice-2-runbook.md` for the full
worked example.

**This sequence, and the asymmetry it relies on, is specific to a UTC
runtime.** On any non-UTC runtime, new-code-against-old-column would parse
offset-less strings in the wrong local timezone, which is exactly as broken
as the old-code-against-new-column case — the preview-and-promote dance
(deploy under test first, migrate, then atomically swap to the tested build)
is the correct approach there, not this shortcut. Re-verify the asymmetry
above against the target runtime before reusing this sequence anywhere else.

`drizzle-kit migrate` applies every pending file inside **one transaction** (`drizzle-orm/pg-core/dialect.js:44-69`), so the locks accumulate until commit. Never let several slices be pending at once. Add `SET LOCAL lock_timeout = '2s'`: a blocked ALTER then stalls new queries on that table for at most 2s and aborts cleanly, rather than waiting indefinitely and exhausting the 3-connection production pool. It does not step aside — work on that table queues behind it for those 2s, and locks already taken on earlier tables stay held while it waits on a later one.

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
6. email_account, email_message, follow_up_queue_item, person_bd_connection (13 columns; runbook `2026-10-01-timestamptz-slice-6-runbook.md`).

**Generator gotchas for slices 5-6 (found in slice 4):** `npm run db:generate` (1) stamps a journal `when` below the hand-set future-dated chain, so `drizzle-kit migrate` would skip the entry; set `when` above the previous entry by hand (`tests/unit/drizzleJournal.test.ts` enforces it), and (2) emits plain `ALTER COLUMN ... TYPE timestamp with time zone`, omitting the `USING ... AT TIME ZONE 'UTC'` clause and the `SET LOCAL lock_timeout`. Hand-write the migration to match `0030`'s shape and keep the generator's snapshot.

**Rollback (per slice, forward-only; never edit an applied migration):** redeploy the previous code first, then apply `ALTER COLUMN c TYPE timestamp USING c AT TIME ZONE 'UTC'`.

## Verification (read-only, before and after each slice)

```sql
select column_name, data_type from information_schema.columns where table_name = '<table>';
select count(*) from <table>;
select id, created_at from <table> order by created_at desc nulls last limit 20;  -- same instants before and after
select indexname from pg_indexes where tablename = '<table>';
```

## Completion record (slice 6)

After slice 6 every timestamp column is `timestamptz`: 71 of 71 (`rg -c 'withTimezone: true' src/db/schema.ts`), and `tests/unit/timestampWithTimezoneConsistency.test.ts` fails if a naive `timestamp(...)` is ever added again. `parseDbTimestamp`'s offset-less branch is dead for DB-sourced strings; the helper stays as the single place the rule is stated and for non-DB callers.

Session-TimeZone dependencies that closed with the final slice: `recomputeMessageSignalsInTx` / `backfill-connection-signals` (`conversation`/`contact` timestamptz assigned into `person_bd_connection`), the `coalesce(person_bd_connection.last_message_at, timestamptz '-infinity')` in `candidateQuery.ts` and `defaultPipelineStageQuery.ts`, and `follow_up_queue_item.last_touch_at` receiving a `timestamptz` from the queue insert.

**Dependency that did NOT close with a migration:** `follow_up_queue_item.queue_date::timestamptz + interval '3 hours'` in `reports/queries.ts`. `queue_date` is a `date` column, so no column conversion applies to it, and `date::timestamptz` is midnight in the session TimeZone. It was fixed in code instead, in the slice 6 PR (`queue_date::timestamp at time zone 'UTC'`, value-identical under UTC). Only `date` columns (`queue_date`, `snoozed_until`) remain outside the timestamptz scheme, by design.

Still open and unrelated to this plan: `task.due_at` stays a timestamp (now `timestamptz`) holding a bare calendar date at 00:00 UTC; moving it to a `date` column is a separate follow-up.
