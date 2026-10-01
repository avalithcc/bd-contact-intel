# Runbook — timestamptz migration, slice 5

Prepared 2026-10-01 on branch `feat/timestamptz-slice-5`. Planning only —
nothing has been applied to production. Read
`openspec/decisions/2026-09-30-timestamptz-migration-plan.md` first,
especially the "Required sequence" section, and
`openspec/decisions/2026-10-01-timestamptz-slice-4-runbook.md`, whose
structure this runbook follows. This document does not repeat that
reasoning, only the slice-specific facts.

Scope: `activity` (`created_at`, `updated_at`) and `task` (`due_at`,
`created_at`, `updated_at`) — 5 columns. After this slice 58 columns are
`timestamptz` (`rg -c 'withTimezone: true' src/db/schema.ts`). Slice 6
(email_account, email_message, follow_up_queue_item, person_bd_connection)
is the last one.

**`task.due_at` stays a timestamp** (now `timestamptz`). Moving it to a
`date` column is a separate follow-up and must not be bundled here;
`tests/unit/timestampWithTimezoneConsistency.test.ts` pins it.

Measured production size (owner-supplied, 2026-10-01): `activity` about
4,235 rows / 1944 kB / 7 indexes; `task` 7 rows / 160 kB / 9 indexes. Both
tiny, so the `ACCESS EXCLUSIVE` window is sub-second, but the ALTER still
rewrites both tables and all their indexes. Record the live pre-flight
numbers in step 2 and trust those over this paragraph.

## Why this slice ships right after slice 4

`buildWonCompaniesDrilldownQuery` (`src/lib/reports/queries.ts:346`) does
`coalesce(rpt_won_at.pbc_won_at, rpt_won_companies.pbc_updated_at)`. After
slice 4 that is `activity.created_at` (naive) against `company.updated_at`
(`timestamptz`), so Postgres casts the naive side with the session TimeZone.
Once `activity.created_at` is `timestamptz` (this slice) both operands are
`timestamptz` and the session-TimeZone dependency disappears. The SQL
expression is intentionally NOT changed. `tests/unit/timestampWithTimezoneConsistency.test.ts`
("won-drilldown coalesce operands are both timestamptz") pins the schema
side of that claim; the dump diff in step 2/4 pins the data side.

## Deploy order (same asymmetry as slices 2-4)

Vercel prod runs `TZ=UTC`. New code (`withTimezone: true`) reading a
still-naive column yields the SAME instant as old code; only old code
against a new `timestamptz` column breaks (`+0000` appended to a string that
already carries an offset -> `Invalid Date`). So: **merge and deploy the code
FIRST, wait for Ready, then apply the migration.** No preview build, no
`vercel promote`. Specific to a UTC runtime; see the plan.

## Files this runbook uses

- Forward migration (journal idx 32, `drizzle/meta/_journal.json`):
  `drizzle/0032_timestamptz_slice_5.sql`
- Rollback (deliberately NOT in the journal — see that file's header
  comment): `drizzle/0032_timestamptz_slice_5_rollback.sql`

Migration provenance: `npm run db:generate` emitted the five `ALTER`s WITHOUT
`USING ... AT TIME ZONE 'UTC'` and without `SET LOCAL lock_timeout`, and
stamped a journal `when` (1790856176122) below idx 31's (1792182271556). The
file was hand-written to match `0031`'s shape, renamed from the generator's
random tag, and the journal entry fixed by hand (tag
`0032_timestamptz_slice_5`, `when` 1792268671556 = idx 31 + 86,400,000).
`drizzle/meta/0032_snapshot.json` is the generator's own snapshot, kept as
emitted. `tests/unit/drizzleJournal.test.ts` and
`tests/unit/drizzleSnapshotSchemaDrift.test.ts` guard all three.

## Consumer audit (done before this PR; re-run if the branch moves)

1. **`effectiveActivityAtSql()`** (`src/lib/contacts/effectiveActivityTime.ts`).
   Verified against the code: only the two `metadata->>...` branches cast
   (`::timestamptz`); the `else activity.createdAt` branch is a bare column.
   Today it is naive and Postgres unifies the `CASE` to `timestamptz` by
   casting that branch with the session TimeZone. After this slice every
   branch is natively `timestamptz`: no unification, no TimeZone dependency.
   Wire shape unchanged (`+00`). Every consumer already parses through
   `parseDbTimestamp`. No code change.
2. **`workedTodayAtSql`** (`src/lib/followUp/queueSelection.ts`) and its
   literal-text twins (`WORKED_TODAY_AT_SQL_TEXT` in
   `src/lib/shell/appShellBadgeCountsQuery.ts`, `WORKED_AT_SQL_TEXT` in
   `src/lib/reports/queries.ts`): same shape as item 1 (`created_at` branches
   bare, `occurredAt` branch cast). Same result: all branches `timestamptz`
   after the slice. Their comparisons are against `${iso}::timestamptz`
   literals — exact. Badge counts: `task_count` compares `task.due_at <
   ${iso}::timestamptz`; naive-vs-timestamptz before, `timestamptz` both sides
   after. The contact-list `lastActivityDays` filter
   (`listQueries.ts:147`) is `effectiveActivityAtSql() >= ${iso}::timestamptz`.
   No code change.
3. **Bare `::timestamp` / `AT TIME ZONE` / `cast(... as timestamp)` on these
   columns** — none anywhere in `src/` or `scripts/` (only comments).
4. **Argentina day boundaries.** `argentinaDayBoundaries` consumers
   (`tasks/queries.ts`, `appShellBadgeCounts.ts`, `api/tasks/digest/route.ts`)
   bound `task.due_at` only, as the allowlist test requires, and still pass.
   `due_at` is written as a bare calendar date at 00:00 UTC
   (`new Date("YYYY-MM-DD")`); stored in `timestamptz` it is the identical UTC
   instant, and every reader uses UTC getters (`taskDueDate`,
   `formatTaskDueDate`) or Date comparisons, so the day arithmetic does not
   move. The typed `lt(task.dueAt, todayStartUtc)` binds an ISO `Z` string:
   against a naive column the `Z` was silently ignored, against `timestamptz`
   it is exact — same value under UTC. `getTasksForPerson` is the one raw
   task read; it goes through `parseDbTimestamp`. `dueBucketOf` accepts a
   string and does a bare `new Date(str)`, but every current caller passes a
   typed `Date`; an offset-less string reaching it would have been a bug
   before, and cannot occur once `due_at` carries `+00`.
   `tests/unit/argentinaDayBoundariesUsage.test.ts` is untouched and passes.
5. **Hand-rolled zone appends on a DB-sourced string** — none for these
   columns. Two raw `new Date(string)` mappers touch them and are NOT
   hazards after this slice because the string now carries an offset:
   `src/lib/reports/meetingsDrilldown.ts` (`effectiveActivityAtSql()` was
   already `timestamptz` via unification) and
   `scripts/cleanup-misattributed-inbound.ts:220` (`activity.created_at`
   raw). The same script's line 229 reads `person_bd_connection.last_message_at`,
   which stays naive until slice 6 — fix it with `parseDbTimestamp` there.
6. **`reports/queries.ts:346` coalesce** — resolved, see "Why this slice
   ships right after slice 4".
7. **Remaining session-TimeZone dependencies after this slice** (all outside
   this slice's columns, all closed by the TimeZone gate pinning `UTC`):
   - `follow_up_queue_item.queue_date::timestamptz + interval '3 hours'` in
     `reports/queries.ts:210-218` (a `date` cast, not a naive column).
   - `person_bd_connection.last_message_at` inside
     `coalesce(..., timestamptz '-infinity')` in `candidateQuery.ts:69-71` and
     `defaultPipelineStageQuery.ts` — naive until slice 6.
   Neither involves `activity` or `task` columns, so neither is fixed here.
8. Writes: every insert/update of these tables is typed Drizzle (ISO string
   param) or `now()`; no raw `INSERT`/`UPDATE` on `activity`/`task` exists.
   Column defaults stay `now()` (`ALTER ... TYPE` keeps the default).

## Operational gotchas (apply here too)

- **`drizzle.config.ts` reads `process.env.DATABASE_URL` directly**; pass it
  explicitly:
  ```
  DATABASE_URL="<prod connection string>" npm run db:migrate
  ```
- **Confirm exactly one migration is pending before running.**
  `drizzle-kit migrate` applies every pending entry inside ONE transaction.
  ```sql
  select count(*) from drizzle.__drizzle_migrations;
  ```
  The journal now has 33 entries (idx 0..32), so prod should report **32**
  applied before this slice runs. 33 means slice 5 was already applied; fewer
  than 32 means an earlier slice is unapplied — investigate first.

## Required sequence (do not reorder)

1. **Merge the PR to `main`.** Wait for the Vercel production deployment to
   reach **Ready**. New code against still-naive columns is harmless on the
   UTC runtime. Record the deployed commit SHA in the checklist.

2. **Capture the before-state** (read-only, against production):
   ```sql
   select table_name, column_name, data_type from information_schema.columns
   where (table_name = 'activity' and column_name in ('created_at', 'updated_at'))
      or (table_name = 'task' and column_name in ('due_at', 'created_at', 'updated_at'))
   order by table_name, column_name;

   select count(*) from activity;
   select count(*) from task;

   select tablename, count(*) from pg_indexes
   where tablename in ('activity', 'task') group by tablename;

   select max(created_at), max(updated_at), min(created_at), min(updated_at) from activity;
   select max(due_at), max(created_at), max(updated_at),
          min(due_at), min(created_at), min(updated_at) from task;

   -- Stable fingerprints of every instant: must be identical after.
   -- Session pinned to UTC so naive::timestamptz and timestamptz::timestamptz
   -- both render YYYY-MM-DD HH:MM:SS.ffffff+00 (state-independent).
   set time zone 'UTC';
   select md5(string_agg(id::text || '|' || created_at::timestamptz::text
                         || '|' || updated_at::timestamptz::text, ',' order by id))
   from activity;

   -- due_at is nullable: a NULL would make the whole concatenation NULL and
   -- string_agg would silently skip the row, so coalesce it explicitly.
   select md5(string_agg(id::text || '|' || coalesce(due_at::timestamptz::text, 'null')
                         || '|' || created_at::timestamptz::text
                         || '|' || updated_at::timestamptz::text, ',' order by id))
   from task;
   ```
   Use exactly these fingerprint forms in both the before and after captures.
   Do NOT replace them with a concatenation of the raw column: the text
   rendering differs between the two types and the comparison would be
   meaningless.

   Also run the **TimeZone gate** and capture the **full won-drilldown dump**:

   ```
   DATABASE_URL="<prod connection string>" npx tsx scripts/check-session-timezone.ts
   DATABASE_URL="<prod connection string>" TZ=UTC npx tsx scripts/dump-won-drilldown.ts > won-drilldown.slice5.before.json
   ```

   **TimeZone gate decision: the existing `scripts/check-session-timezone.ts`
   suffices; no slice-5 sample is added.** The gate asserts the app's pooled
   connection reports `UTC` for `current_setting('TimeZone')` and `show
   timezone`; that is a property of the connection, not of any table, so
   sampling `company` is as good as sampling `activity`. It must exit 0 and
   print `UTC`; if it does not, STOP before step 3. Its `company` sample
   already demonstrates the wire shape change from slice 4. For this slice's
   own wire-shape evidence, capture one activity row through the app's
   client (read-only), before and after:
   ```sql
   select id, created_at from activity order by id limit 1;
   ```
   Expect `2026-09-29 23:50:17.913289` before and `...+00` after, parsing to
   the identical instant.

   Record the results here before continuing:
   `<PASTE BEFORE-STATE RESULTS HERE>`

   Pre-flight figures to cross-check against (owner-supplied):
   - `activity` rows / on-disk size / index count: `TO BE FILLED FROM PRE-FLIGHT`
   - `task` rows / on-disk size / index count: `TO BE FILLED FROM PRE-FLIGHT`
   - `select count(*) from drizzle.__drizzle_migrations`: `TO BE FILLED FROM PRE-FLIGHT`
   - TimeZone gate (the app's pooled connection): `TO BE FILLED FROM PRE-FLIGHT` (must read `UTC`)
   - Any long-running transaction or open lock on `activity` or `task`:
     `TO BE FILLED FROM PRE-FLIGHT`

3. **Apply the migration to production** by hand:
   ```
   DATABASE_URL="<prod connection string>" npm run db:migrate
   ```
   `SET LOCAL lock_timeout = '2s'` is the first statement of
   `0032_timestamptz_slice_5.sql`, so a blocked `ALTER` aborts the
   transaction within 2 seconds instead of starving the 3-connection pool.
   If it aborts on the lock, nothing changed; retry at a quieter moment.
   The two tables are locked together until commit, so do it off-peak.

4. **Run the verification queries** below and compare with step 2.

## Verification (run after step 3)

Re-run the step 2 queries and confirm:

- `data_type` for all five columns changes from `timestamp without time zone`
  to `timestamp with time zone`.
- `count(*)` for `activity` and `task` is unchanged.
- The index counts (7 and 9) are unchanged.
- `max`/`min` of every column are the same instants (not shifted).
- Both `md5` fingerprints (UTC session form) are IDENTICAL to the before values.
- `check-session-timezone.ts` still exits 0 with `UTC`.
- Re-run the dump and diff it against the before capture:
  ```
  DATABASE_URL="<prod connection string>" TZ=UTC npx tsx scripts/dump-won-drilldown.ts > won-drilldown.slice5.after.json
  diff won-drilldown.slice5.before.json won-drilldown.slice5.after.json
  ```
  Expected: **no output.** Any difference means a naive side was cast in a
  non-UTC zone: STOP and roll back. (Compare against the slice 4 `after`
  dump too; all three must match.)

**The check that matters is typed Drizzle reads returning valid `Date`s plus
the raw reads that parse strings** — the failure mode is `Invalid Date`, not
data loss. Read-only, from a one-off `tsx` against prod:

```ts
import { desc } from "drizzle-orm";
import { db } from "./src/db";
import { activity, task } from "./src/db/schema";

const ok = (d: unknown) => d instanceof Date && !Number.isNaN(d.getTime());
const [a] = await db.select({ c: activity.createdAt, u: activity.updatedAt }).from(activity).orderBy(desc(activity.createdAt)).limit(1);
console.log("activity:", a, ok(a?.c), ok(a?.u));
const [t] = await db.select({ d: task.dueAt, c: task.createdAt, u: task.updatedAt }).from(task).orderBy(desc(task.createdAt)).limit(1);
console.log("task:", t, ok(t?.d) || t?.d === null, ok(t?.c), ok(t?.u));
```

Then exercise the raw readers through the app's own functions (arguments
exact; pick a real person id with tasks and activity):

- `getTasksForPerson(<personId>)` (`src/lib/tasks/queries.ts`) — every
  `dueAt`/`createdAt`/`updatedAt` a valid `Date`; `dueAt` equals the
  `due_at` instants captured in step 2.
- `getTaskBadgeCount(<bdId>, argentinaDayBoundaries(new Date()).tomorrowStartUtc)`
  and `getOverdueTasks(<bdId>)` — same counts as before the migration.
- `getAppShellBadgeCounts(<bdId>, new Date())`
  (`src/lib/shell/appShellBadgeCounts.ts`) — same `taskCount` and follow-up
  count as before.
- `getWonCompaniesDrilldown({ bdId: null })`
  (`src/lib/reports/queriesDb.ts`) — the dump diff above.
- The contacts list with `lastActivityDays=30` and the default sort — same
  row order and "Última actividad" values as before.

If anything prints `Invalid Date` at any point, STOP: some deployed instance
disagrees with the DB about the column type.

## If verification fails, or the deploy in step 1 needs to be undone

Forward-only, in this order:

1. Redeploy the previous production code (the commit before this branch, so
   `schema.ts` has plain `timestamp` for `activity`/`task` again) FIRST.
2. Only then apply the rollback by hand as ONE transaction:
   ```
   psql --single-transaction "$DATABASE_URL" -f drizzle/0032_timestamptz_slice_5_rollback.sql
   ```
   or a postgres.js script running the whole file inside
   `sql.begin(async (sql) => { ... })`. Never plain autocommit `psql -c`.
3. Re-run the verification queries and confirm `data_type` is back to
   `timestamp without time zone` with the same counts, instants and
   fingerprints.

## Owner approval

- [ ] Pre-flight numbers filled into this document (every
      `TO BE FILLED FROM PRE-FLIGHT`)
- [ ] Dry run reviewed (this document + the diff on `feat/timestamptz-slice-5`)
- [ ] Owner approved production execution
- [ ] PR merged to `main`; production deploy reached Ready — commit SHA
      recorded here: `<PASTE COMMIT SHA HERE>`
- [ ] `select count(*) from drizzle.__drizzle_migrations` reports 32
- [ ] `scripts/check-session-timezone.ts` exited 0 (`UTC`) and its output is recorded
- [ ] Before-state queries, both fingerprints and `won-drilldown.slice5.before.json` captured and recorded above
- [ ] `DATABASE_URL=... npm run db:migrate` executed against production
- [ ] Verification queries confirm the migration (step 4), including both identical `md5` fingerprints
- [ ] `diff won-drilldown.slice5.before.json won-drilldown.slice5.after.json` is empty
- [ ] Typed-Drizzle-read checks (`activity`, `task`) AND the raw-reader checks print valid `Date`s and unchanged counts
