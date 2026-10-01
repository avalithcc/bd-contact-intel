# Runbook — timestamptz migration, slice 3

Prepared 2026-09-30 on branch `feat/timestamptz-slice-3`. Planning only —
nothing has been applied to production. Read
`openspec/decisions/2026-09-30-timestamptz-migration-plan.md` first,
especially the "Required sequence" section — this runbook exists to enforce
that exact sequence for slice 3. The pattern is the same one
`openspec/decisions/2026-09-30-timestamptz-slice-2-runbook.md` worked
through; this document does not repeat that reasoning, only the
slice-specific facts.

Scope: `lead` (3 columns: `updated_at`, `created_at`, `last_imported_at`),
`person` (2 columns: `created_at`, `updated_at`) — 5 columns across 2
tables. Measured against production 2026-09-30: `lead` 1,058 rows / 984 kB
/ 8 indexes, `person` 27,626 rows / 21 MB / 13 indexes. **Note the
discrepancy against the task brief's `person` row count (26,600): the
brief's figure is stale relative to this measurement — re-confirm the live
count as part of the before-state capture below (step 2) rather than
trusting either number.**

`person` is the central table of this system: contacts, identity
resolution, merges, the board, the follow-up queue and every report hang
off it. Unlike slice 1's low-traffic tables, this is comparable in
exposure to slice 2's `contact`/`conversation` — expect it to be read on
nearly every page in the app (`/contacts`, the record page, `/companies`
record page, `/admin/reports`, the board, the follow-up queue, merge/
unmerge, every identity-matcher read).

## Why the sequence is inverted (same asymmetry as slice 2)

Vercel prod runs `TZ=UTC`. On that runtime, new code
(`withTimezone: true`) reading an old, still-naive column produces the
SAME instant as old code reading it (`PgTimestamp.mapFromDriverValue`'s
"parse the offset-less string in the process timezone" branch is a no-op
when the process timezone already IS UTC). Only the opposite mismatch (old
code, new `timestamptz` column) breaks, by appending `+0000` to a string
that already carries an offset, producing `Invalid Date`. So: **merge and
deploy the code to production FIRST, wait for Ready, and only then apply
the migration.** No preview build, no `vercel promote`. See the migration
plan's "Required sequence" section for the general rule and its
UTC-runtime caveat.

## Files this runbook uses

- Forward migration (in the drizzle journal, `drizzle/meta/_journal.json`
  idx 30): `drizzle/0030_timestamptz_slice_3.sql`
- Rollback (deliberately NOT in the journal — see that file's header
  comment): `drizzle/0030_timestamptz_slice_3_rollback.sql`

## Operational gotchas learned during slices 1-2 (apply here too)

- **`drizzle.config.ts` reads `process.env.DATABASE_URL` directly** (no
  `.env.local` fallback wired into drizzle-kit itself). A worktree checkout
  has no `.env.local`, so `npm run db:migrate` fails there with
  `DATABASE_URL is not set` unless the variable is passed explicitly on the
  command line:
  ```
  DATABASE_URL="<prod connection string>" npm run db:migrate
  ```
- **Confirm exactly one migration is pending before running.** `drizzle-kit
  migrate` applies every pending journal entry inside ONE transaction, so
  if more than one slice's migration is pending, their locks accumulate
  until a single commit. Compare the journal's entry count against prod's
  applied-migrations table:
  ```sql
  select count(*) from drizzle.__drizzle_migrations;
  ```
  This should equal the journal's entry count MINUS ONE (idx 0..30 is 31
  entries; before this slice runs, prod should report 30 applied — i.e.
  everything through idx 29/slice 2). If it already reports 31, slice 3 was
  already applied; if it reports fewer than 30, an earlier slice has not
  been applied and must be investigated before proceeding.

## Required sequence (do not reorder)

1. **Merge the PR to `main`.** The production deploy builds from `main`
   automatically. Wait for the Vercel deployment to reach **Ready** before
   continuing — this is new code (`withTimezone: true`) running against the
   still-unmigrated (naive `timestamp`) `lead`/`person` columns, which is
   harmless on Vercel's UTC runtime (see "Why the sequence is inverted"
   above). No preview build, no promote — this is a normal `git
   push`-triggered production deploy.

2. **Capture the before-state** (read-only, run against production):
   ```sql
   select column_name, data_type from information_schema.columns
   where table_name in ('lead', 'person')
   order by table_name, column_name;

   select 'lead' as t, count(*) from lead
   union all select 'person', count(*) from person;

   select tablename, count(*) from pg_indexes
   where tablename in ('lead', 'person')
   group by tablename;

   select max(updated_at), max(created_at), max(last_imported_at) from lead;
   select max(created_at), max(updated_at) from person;

   -- A merged person still resolves (person is the identity table —
   -- confirm a merged-away row's timestamps parse too, not just a live one).
   select id, merged_into_id, created_at, updated_at
   from person
   where merged_into_id is not null
   order by updated_at desc nulls last
   limit 5;
   ```
   Record the results here before continuing:
   `<PASTE BEFORE-STATE RESULTS HERE>`

3. **Apply the migration to production** by hand:
   ```
   DATABASE_URL="<prod connection string>" npm run db:migrate
   ```
   `SET LOCAL lock_timeout = '2s'` is the first statement in
   `0030_timestamptz_slice_3.sql`, so a blocked `ALTER` aborts the whole
   transaction within 2 seconds instead of queuing and starving the
   3-connection production pool. Because the code deployed in step 1
   already declares `withTimezone: true` for all 5 columns, there is no
   window — before this commits, every typed read already got the correct
   instant off the naive column; after it commits, every typed read gets
   the correct instant off the `timestamptz` column.

4. **Run the verification queries** below against production and confirm
   the counts/instants match what was recorded in step 2.

## Verification (run after step 3)

Re-run the `information_schema`/count/index/`max(...)` queries from step 2
and confirm:

- `data_type` for all 5 columns listed above changes from `timestamp
  without time zone` to `timestamp with time zone`.
- `count(*)` for both tables is unchanged.
- The index count per table is unchanged (`lead` 8, `person` 13 — reconfirm
  against the live schema if this runbook's numbers and the before-state
  capture disagree).
- Each `max(...)` instant is unchanged (same ISO instant, not shifted).
- The merged-person query from step 2 returns the SAME rows with the SAME
  `created_at`/`updated_at` instants (not `Invalid Date`, not shifted) —
  this is the slice-3-specific check: `person` is the identity table, and a
  merged-away row (`merged_into_id is not null`) is hidden from every
  normal read path but must still resolve correctly wherever it IS read
  (e.g. `unmergeContact`, `getDuplicateCandidateDetail`).

**The check that actually matters is a typed Drizzle read returning a valid
`Date`, not a row count — the failure mode this migration guards against is
`Invalid Date`, not data loss.** One read per table, plus the merged-person
check, run from a Node REPL or a one-off `tsx` invocation against prod
(read-only, no writes):

```ts
import { desc, isNotNull } from "drizzle-orm";
import { db } from "./src/db";
import { lead, person } from "./src/db/schema";

const l = await db.select({ updatedAt: lead.updatedAt, createdAt: lead.createdAt, lastImportedAt: lead.lastImportedAt })
  .from(lead).orderBy(desc(lead.lastImportedAt)).limit(1);
console.log("lead:", l[0], l[0]?.createdAt instanceof Date, l[0]?.updatedAt instanceof Date, l[0]?.lastImportedAt instanceof Date);

const p = await db.select({ createdAt: person.createdAt, updatedAt: person.updatedAt })
  .from(person).orderBy(desc(person.updatedAt)).limit(1);
console.log("person:", p[0], p[0]?.createdAt instanceof Date, p[0]?.updatedAt instanceof Date);

// person is the identity table: a merged-away row must still resolve with
// valid instants, not just a live one (unmergeContact/getDuplicateCandidateDetail
// read these rows directly).
const merged = await db.select({ id: person.id, mergedIntoId: person.mergedIntoId, createdAt: person.createdAt, updatedAt: person.updatedAt })
  .from(person).where(isNotNull(person.mergedIntoId)).orderBy(desc(person.updatedAt)).limit(1);
console.log("merged person:", merged[0], merged[0]?.createdAt instanceof Date, merged[0]?.updatedAt instanceof Date);
```

Expect every `instanceof Date` check to print `true` and the printed value
to be a real date (NOT the string `Invalid Date`), both before step 1
(already true today, against the naive columns) and after step 3 (now true
against the `timestamptz` columns). If any of them print `Invalid Date` at
any point, STOP — that is the deploy-order hazard, and it means some
deployed instance of the code disagrees with the DB about these columns'
type.

## If verification fails, or the deploy in step 1 needs to be undone

Roll back in this order (per the plan's "Rollback" note — forward-only,
never edit an applied migration):

1. Redeploy the previous production code (the commit before this branch, so
   `schema.ts` has `withTimezone: false` for these 5 columns again) FIRST.
2. Only then apply `drizzle/0030_timestamptz_slice_3_rollback.sql` to
   production by hand, as ONE transaction:
   ```
   psql --single-transaction "$DATABASE_URL" -f drizzle/0030_timestamptz_slice_3_rollback.sql
   ```
   or a small postgres.js script that runs the whole file inside
   `sql.begin(async (sql) => { ... })`. Never run it with plain autocommit
   `psql -c` one statement at a time.
3. Re-run the verification queries above and confirm `data_type` is back to
   `timestamp without time zone` with the same counts/instants.

## Owner approval

- [ ] Dry run reviewed (this document + the diff on
      `feat/timestamptz-slice-3`)
- [ ] Owner approved production execution
- [ ] PR merged to `main`; production deploy reached Ready — commit SHA
      recorded here: `<PASTE COMMIT SHA HERE>`
- [ ] Before-state queries (step 2) run and recorded above
- [ ] `DATABASE_URL=... npm run db:migrate` executed against production
- [ ] Verification queries confirm the migration (step 4)
- [ ] Both typed-Drizzle-read checks (`lead`, `person`) AND the
      merged-person check print valid `Date`s, not `Invalid Date`
