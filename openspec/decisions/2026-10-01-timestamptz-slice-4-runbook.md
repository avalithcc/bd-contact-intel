# Runbook — timestamptz migration, slice 4

Prepared 2026-10-01 on branch `feat/timestamptz-slice-4`. Planning only —
nothing has been applied to production. Read
`openspec/decisions/2026-09-30-timestamptz-migration-plan.md` first,
especially the "Required sequence" section — this runbook enforces that
exact sequence for slice 4. The pattern is the one
`openspec/decisions/2026-09-30-timestamptz-slice-3-runbook.md` worked
through; this document does not repeat that reasoning, only the
slice-specific facts.

Scope: `company` only — 2 columns, `created_at` and `updated_at`. The
table's other timestamp-bearing neighbours (`company_alias`,
`company_category`, `company_probe`, `company_property_history`) already
converted in slice 1 and are NOT touched here.

Production size of `company`: `TO BE FILLED FROM PRE-FLIGHT` rows,
`TO BE FILLED FROM PRE-FLIGHT` on disk, `TO BE FILLED FROM PRE-FLIGHT`
indexes. Do not trust any number other than the pre-flight capture and the
live before-state in step 2 below.

## Why the sequence is inverted (same asymmetry as slices 2-3)

Vercel prod runs `TZ=UTC`. New code (`withTimezone: true`) reading a
still-naive column produces the SAME instant as old code (the "parse the
offset-less string in the process timezone" branch of
`PgTimestamp.mapFromDriverValue` is a no-op when the process timezone is
UTC). Only old code against a new `timestamptz` column breaks (`+0000`
appended to a string that already carries an offset -> `Invalid Date`). So:
**merge and deploy the code FIRST, wait for Ready, then apply the
migration.** No preview build, no `vercel promote`. This is specific to a
UTC runtime; see the plan's "Required sequence" caveat.

## Files this runbook uses

- Forward migration (journal idx 31, `drizzle/meta/_journal.json`):
  `drizzle/0031_timestamptz_slice_4.sql`
- Rollback (deliberately NOT in the journal — see that file's header
  comment): `drizzle/0031_timestamptz_slice_4_rollback.sql`

Migration provenance: `npm run db:generate` emitted the two `ALTER`s
WITHOUT the `USING ... AT TIME ZONE 'UTC'` clause and without
`SET LOCAL lock_timeout`, and stamped a journal `when` (1790854506068) lower
than idx 30's (1792095871556). The file was therefore hand-written to match
`0030`'s shape and the journal entry fixed by hand (`when` 1792182271556).
`drizzle/meta/0031_snapshot.json` is the generator's own snapshot,
kept as emitted.

## Consumer audit (done before this PR; re-run if the branch moves)

Every reader and writer of `company.created_at` / `company.updated_at`:

- Typed Drizzle reads (`src/lib/companies/queries.ts`: `getCompanies`,
  `getCompanyByKey`) — follow the column's `withTimezone` flag. Safe.
- `scripts/backfill-default-pipeline-stage.ts:164-166` — raw
  `UPDATE company ... updated_at = now()`. `now()` is `timestamptz`; assigning
  it to a `timestamptz` column is exact (and to a naive column it was
  session-TZ-dependent before). Safe.
- `scripts/backfill-hubspot-company-fields.ts:144` — raw `UPDATE company`
  that does NOT write `updated_at` or `created_at` at all (sets `industry`,
  `city`, `country`, `owner_bd_id`). Unaffected.
- `src/lib/reports/queries.ts:309` (`buildWonCompaniesDrilldownQuery`) —
  `company.updated_at as pbc_updated_at`, fed into
  `coalesce(rpt_won_at.pbc_won_at, rpt_won_companies.pbc_updated_at)`. Mixes
  the still-naive `activity.created_at` with the now-`timestamptz`
  `company.updated_at`, so Postgres unifies the result to `timestamptz`
  and casts the naive side using the session TimeZone (Supabase default
  UTC — the same dependency the plan already accepts for the other
  `::timestamptz` casts). The wire string gains a `+00` offset. The row
  mapper `buildWonCompanyDrilldownRows` previously did a bare
  `new Date(str)`; it now goes through `parseDbTimestamp`
  (`src/lib/db/timestamp.ts`), which handles both the offset-less and the
  `+00` shapes on any process timezone. Covered by tests in
  `tests/unit/reportsWonCompaniesDrilldown.test.ts`. This is the one code
  change in this PR beyond `schema.ts`.
- Bare `::timestamp` casts touching these columns — none. The only
  `::timestamp` hit under `src/` and `scripts/` is a comment in
  `src/lib/hiring/discovery.ts` (already fixed in slice 0).
- Hand-rolled zone appends on a DB-sourced string (`+ "Z"`, `+0000`,
  template-literal `Z`) — none for these columns. The only matches are
  `src/lib/db/timestamp.ts` itself (guarded by `HAS_ZONE_SUFFIX_RE`),
  `src/lib/messagesCsv.ts` (parses a LinkedIn CSV date, not a DB value) and
  `src/lib/tasks/argentinaDate.ts` (builds dates from calendar strings).
- Other raw SQL joins of `company` (`reports/queries.ts:125,395`,
  `tasks/queries.ts:353`, `followUp/candidateQuery.ts:76`,
  `companies/defaultPipelineStageQuery.ts:91`) select no `company`
  timestamp column.

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
  The journal now has 32 entries (idx 0..31), so prod should report **31**
  applied before this slice runs. 32 means slice 4 was already applied;
  fewer than 31 means an earlier slice is unapplied — investigate first.

## Required sequence (do not reorder)

1. **Merge the PR to `main`.** Wait for the Vercel production deployment to
   reach **Ready**. This is new code running against the still-naive
   `company` columns — harmless on the UTC runtime. Record the deployed
   commit SHA in the checklist.

2. **Capture the before-state** (read-only, against production):
   ```sql
   select column_name, data_type from information_schema.columns
   where table_name = 'company' and column_name in ('created_at', 'updated_at')
   order by column_name;

   select count(*) from company;

   select count(*) from pg_indexes where tablename = 'company';

   select max(created_at), max(updated_at), min(created_at), min(updated_at)
   from company;

   -- Stable fingerprint of every instant: must be identical after.
   -- Session pinned to UTC so naive::timestamptz and timestamptz::timestamptz
   -- both render YYYY-MM-DD HH:MM:SS.ffffff+00 (state-independent).
   set time zone 'UTC';
   select md5(string_agg(company_key || '|' || created_at::timestamptz::text
                         || '|' || updated_at::timestamptz::text, ',' order by company_key))
   from company;
   ```
   Use exactly this fingerprint form in both the before and after captures.

   Also capture the won-companies drilldown input (the one mixed
   naive/timestamptz consumer):
   ```sql
   select company_key, updated_at from company
   where relationship_stage = 'won' order by company_key;
   ```
   Record the results here before continuing:
   `<PASTE BEFORE-STATE RESULTS HERE>`

   Pre-flight figures to cross-check against (owner-supplied):
   - `company` rows: `TO BE FILLED FROM PRE-FLIGHT`
   - on-disk size: `TO BE FILLED FROM PRE-FLIGHT`
   - index count: `TO BE FILLED FROM PRE-FLIGHT`
   - `select count(*) from drizzle.__drizzle_migrations`: `TO BE FILLED FROM PRE-FLIGHT`
   - session `show timezone` on the production connection: `TO BE FILLED FROM PRE-FLIGHT`
   - Any long-running transaction or open lock on `company` at pre-flight
     time: `TO BE FILLED FROM PRE-FLIGHT`

3. **Apply the migration to production** by hand:
   ```
   DATABASE_URL="<prod connection string>" npm run db:migrate
   ```
   `SET LOCAL lock_timeout = '2s'` is the first statement of
   `0031_timestamptz_slice_4.sql`, so a blocked `ALTER` aborts the
   transaction within 2 seconds instead of starving the 3-connection pool.
   If it aborts on the lock, nothing changed; retry at a quieter moment.

4. **Run the verification queries** below and compare with step 2.

## Verification (run after step 3)

Re-run the step 2 queries and confirm:

- `data_type` for both columns changes from `timestamp without time zone`
  to `timestamp with time zone`.
- `count(*)` from `company` is unchanged.
- The index count for `company` is unchanged.
- `max`/`min` of both columns are the same instants (not shifted).
- The `md5` fingerprint (UTC session form) is IDENTICAL to the before value.
- The `won` companies' `updated_at` values are the same instants.

**The check that matters is a typed Drizzle read returning a valid `Date`,
plus the one mixed-type raw read** — the failure mode is `Invalid Date`,
not data loss. Read-only, from a one-off `tsx` against prod:

```ts
import { desc } from "drizzle-orm";
import { db } from "./src/db";
import { company } from "./src/db/schema";
import { getCompanies, getCompanyByKey } from "./src/lib/companies/queries";
import { getWonCompaniesDrilldown } from "./src/lib/reports/queriesDb";

const c = await db.select({ createdAt: company.createdAt, updatedAt: company.updatedAt, key: company.companyKey })
  .from(company).orderBy(desc(company.updatedAt)).limit(1);
console.log("company:", c[0], c[0]?.createdAt instanceof Date, c[0]?.updatedAt instanceof Date);

const page = await getCompanies({} as never, 1, 5);
console.log("getCompanies:", page.rows.map((r) => [r.createdAt, r.updatedAt].every((d) => d instanceof Date && !Number.isNaN(d.getTime()))));

const one = c[0] ? await getCompanyByKey(c[0].key) : null;
console.log("getCompanyByKey:", one?.createdAt, one?.updatedAt);

const won = await getWonCompaniesDrilldown({ bdId: null });
console.log("won drilldown:", won.length, won.every((r) => r.wonAt instanceof Date && !Number.isNaN(r.wonAt.getTime())));
```

Expect every `instanceof Date` and validity check to print `true`, and the
won-drilldown `wonAt` values for rows with `wonAtExact === false` to equal
the `updated_at` instants recorded in step 2. Adjust the `getCompanies`
filter argument and the `rows` property name to the real `CompaniesPage`
shape when writing the one-off script. If anything prints `Invalid Date`
at any point, STOP: some deployed instance disagrees with the DB about the
column type.

Note on the won drilldown: rows with `wonAtExact === true` carry
`activity.created_at` (still naive until slice 5), which Postgres casts to
`timestamptz` with the session TimeZone. The pre-flight `show timezone`
value above must be `UTC` for those instants to be unchanged. If it is not
`UTC`, STOP and raise it before step 3.

## If verification fails, or the deploy in step 1 needs to be undone

Forward-only, in this order:

1. Redeploy the previous production code (the commit before this branch, so
   `schema.ts` has plain `timestamp` for `company` again) FIRST.
2. Only then apply the rollback by hand as ONE transaction:
   ```
   psql --single-transaction "$DATABASE_URL" -f drizzle/0031_timestamptz_slice_4_rollback.sql
   ```
   or a postgres.js script running the whole file inside
   `sql.begin(async (sql) => { ... })`. Never plain autocommit `psql -c`.
3. Re-run the verification queries and confirm `data_type` is back to
   `timestamp without time zone` with the same counts, instants and
   fingerprint.

## Owner approval

- [ ] Pre-flight numbers filled into this document (every
      `TO BE FILLED FROM PRE-FLIGHT`)
- [ ] Dry run reviewed (this document + the diff on
      `feat/timestamptz-slice-4`)
- [ ] Owner approved production execution
- [ ] PR merged to `main`; production deploy reached Ready — commit SHA
      recorded here: `<PASTE COMMIT SHA HERE>`
- [ ] `select count(*) from drizzle.__drizzle_migrations` reports 31
- [ ] Before-state queries (step 2) run and recorded above
- [ ] `DATABASE_URL=... npm run db:migrate` executed against production
- [ ] Verification queries confirm the migration (step 4), including the
      identical `md5` fingerprint
- [ ] Typed-Drizzle-read checks (`company`, `getCompanies`,
      `getCompanyByKey`) AND the won-drilldown check print valid `Date`s
