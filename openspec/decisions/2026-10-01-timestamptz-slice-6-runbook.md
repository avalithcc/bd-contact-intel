# Runbook — timestamptz migration, slice 6 (final)

Prepared 2026-10-01 on branch `feat/timestamptz-slice-6`. Planning only —
nothing has been applied to production. Read
`openspec/decisions/2026-09-30-timestamptz-migration-plan.md` first,
especially the "Required sequence" section, and
`openspec/decisions/2026-10-01-timestamptz-slice-5-runbook.md`, whose
structure this runbook follows. This document does not repeat that
reasoning, only the slice-specific facts.

Scope: 13 columns across 4 tables.

| Table | Columns | Nullable columns |
| --- | --- | --- |
| `person_bd_connection` | `first_message_at`, `last_message_at`, `created_at` | `first_message_at`, `last_message_at` |
| `email_account` | `last_synced_at`, `reconnect_banner_dismissed_at`, `connected_at`, `disconnected_at`, `updated_at` | `last_synced_at`, `reconnect_banner_dismissed_at`, `disconnected_at` |
| `email_message` | `sent_at`, `created_at` | none |
| `follow_up_queue_item` | `last_touch_at`, `created_at`, `updated_at` | none |

(Nullability verified column by column against `src/db/schema.ts`: exactly
five are nullable. `follow_up_queue_item.last_touch_at` is `notNull`, so it
is NOT coalesced. The fingerprints below coalesce every nullable one.)

After this slice **71 of 71** timestamp columns are `timestamptz`
(`rg -c 'withTimezone: true' src/db/schema.ts` = 71; no naive `timestamp("...")`
remains, pinned by `tests/unit/timestampWithTimezoneConsistency.test.ts`).
This closes the migration.

Measured production size (owner-supplied, 2026-10-01): `person_bd_connection`
21,459 rows / 4960 kB / 2 indexes; `email_message` 307 rows / 1008 kB / 4
indexes; `follow_up_queue_item` 20 rows / 64 kB / 3 indexes; `email_account`
2 rows / 48 kB / 2 indexes. All small, so the `ACCESS EXCLUSIVE` window is
sub-second, but the ALTER still rewrites all four tables and their indexes.
Record the live pre-flight numbers in step 2 and trust those over this
paragraph.

## Deploy order (same asymmetry as slices 2-5)

Vercel prod runs `TZ=UTC`. New code (`withTimezone: true`) reading a
still-naive column yields the SAME instant as old code; only old code
against a new `timestamptz` column breaks (`+0000` appended to a string that
already carries an offset -> `Invalid Date`). So: **merge and deploy the code
FIRST, wait for Ready, then apply the migration.** No preview build, no
`vercel promote`. Specific to a UTC runtime; see the plan.

## Files this runbook uses

- Forward migration (journal idx 33, `drizzle/meta/_journal.json`):
  `drizzle/0033_timestamptz_slice_6.sql`
- Rollback (deliberately NOT in the journal — see that file's header
  comment): `drizzle/0033_timestamptz_slice_6_rollback.sql`

Migration provenance: `npm run db:generate` emitted the 13 `ALTER`s WITHOUT
`USING ... AT TIME ZONE 'UTC'` and without `SET LOCAL lock_timeout`, under a
random tag (`0033_lying_songbird`) and a journal `when` (1790857049155)
below idx 32's (1792268671556). The file was hand-written to match `0032`'s
shape, the random-tag SQL file deleted, and the journal entry fixed by hand
(tag `0033_timestamptz_slice_6`, `when` 1792355071556 = idx 32 + 86,400,000).
`drizzle/meta/0033_snapshot.json` is the generator's own snapshot, kept as
emitted. `tests/unit/drizzleJournal.test.ts`,
`tests/unit/drizzleSnapshotSchemaDrift.test.ts` and
`tests/unit/timestamptzMigrationSql.test.ts` guard all of it.

## Consumer audit (done before this PR; re-run if the branch moves)

### The three known hazards

1. **`recomputeMessageSignalsInTx` (`src/lib/queries.ts`) — closes with this
   slice, no intermediate state breaks.** Verified against the code: the
   source of the timestamps is NOT `contact` but
   `conversation.first_message_at`/`last_message_at`, aggregated in the
   `peer_agg` CTE with `min()`/`max()`, then assigned to BOTH
   `contact.first/last_message_at` (timestamptz since slice 2) and, behind
   `IDENTITY_DUAL_WRITE`, `person_bd_connection.first/last_message_at`.
   - Before this slice: `conversation` is `timestamptz`,
     `person_bd_connection` is naive. Postgres applies an assignment cast
     `timestamptz -> timestamp` using the SESSION TimeZone. Correct only
     because the gate pins the session to UTC.
   - After this slice: both sides are `timestamptz`, no cast, no
     TimeZone dependency.
   - Intermediate state: none that matters. The migration is one transaction
     (`ACCESS EXCLUSIVE`), so any statement sees either all-naive or
     all-timestamptz for `person_bd_connection`; the SQL text is unchanged and
     valid in both states. The SAME dependency existed in
     `scripts/backfill-connection-signals.ts` (`contact.*` -> `pbc.*`) and
     closes the same way. No code change.
2. **`person_bd_connection.last_message_at` inside
   `coalesce(..., timestamptz '-infinity')`**
   (`src/lib/followUp/candidateQuery.ts` `fuq_candidate`,
   `src/lib/companies/defaultPipelineStageQuery.ts` `dps_touch`) — **closes
   with this slice.** `max(person_bd_connection.last_message_at)` becomes
   `timestamptz`, so the `coalesce` unifies two `timestamptz` operands with no
   session-TimeZone cast. Same-shaped dependency also closed here:
   `buildFollowUpInsertQuery` inserts `fuq_last_touch` (a `timestamptz`
   `greatest(...)`) into `follow_up_queue_item.last_touch_at`, which was an
   implicit session-TimeZone assignment cast into a naive column. SQL
   unchanged; only the stale "stays naive until slice 6" comments were
   updated.
3. **`follow_up_queue_item.queue_date::timestamptz + interval '3 hours'`
   (`src/lib/reports/queries.ts`, `rpt_queue_pivot`) — `queue_date` is a
   `date` column (`queueDate: date("queue_date")`), NOT a timestamp, so it
   is NOT converted by this migration and the dependency does NOT close with
   it.** `date::timestamptz` is midnight in the SESSION TimeZone, so the ART
   "worked" window silently moved with the session zone. Rather than leave
   it as a follow-up, this PR removes the dependency in the query itself
   (separate commit, droppable): all four occurrences now use a shared
   `QUEUE_DAY_START_UTC_SQL_TEXT` =
   `(follow_up_queue_item.queue_date::timestamp at time zone 'UTC')`, i.e.
   midnight UTC pinned explicitly. Value is identical while the session is
   UTC, so the report output must not change (see Verification). The
   `snoozed_until` and `queue_date` columns remain `date` and are out of the
   timestamptz plan entirely.

### Everything else

4. **Bare `::timestamp` / `AT TIME ZONE` / `cast(... as timestamp)`** — none
   anywhere in `src/` or `scripts/` except comments (and the new, deliberate
   one in hazard 3, which is `date -> timestamp`, not session-dependent).
5. **Hand-rolled zone appends on a DB-sourced string** — searched `src/` and
   `scripts/` for `+ "Z"`, `` `${...}Z` ``, `+0000`, `+00:00`. The only hit
   outside `src/lib/db/timestamp.ts` is `src/lib/messagesCsv.ts:76`, which
   parses a LinkedIn CSV cell, not a DB value. No third instance of the
   slice-4/slice-5 bug exists for these columns. Every raw string reader of
   these columns goes through `parseDbTimestamp`:
   `src/lib/status/rawStatusRows.ts` (`last_message_at`),
   `src/lib/outreach/queries.ts:229` (`max(last_message_at)`),
   `scripts/cleanup-misattributed-inbound.ts` (via `mapRawConnectionRow`,
   fixed in slice 5), `scripts/verify-last-activity-utc.ts` (`iso()`).
6. **`getAppShellBadgeCounts`** (`appShellBadgeCountsQuery.ts`) puts
   `email_account.reconnect_banner_dismissed_at` inside `json_build_object`.
   The JSON rendering changes from `2026-09-30T10:00:00` (offset-less) to
   `2026-09-30T10:00:00+00:00`. The only consumer is
   `shouldShowReconnectBanner`, which tests truthiness
   (`if (input.reconnectBannerDismissedAt) return false`) and never parses it.
   No change.
7. **Gmail sync, backfill, send, connect/disconnect/dismiss actions and the
   OAuth callback** (`email_account`, `email_message`): every write is typed
   Drizzle (`new Date()` -> ISO string param, or `now()` defaults); every
   read is a typed column select (`syncQueries.ts`, `threadMessages.ts`,
   `getConversationForAdmin.ts`). No raw `INSERT`/`UPDATE` and no computed
   `sql<Date>` on these tables. `email_message.sent_at` is written from
   `new Date(Number(internalDate))` (`parseMessage.ts`) — an exact instant.
8. **Importers / identity / merge** write `person_bd_connection` through typed
   Drizzle. Merge snapshots (`merge_event.snapshot`) JSON-serialize typed
   `Date`s as `Z` ISO strings and revive them with `new Date(...)`
   (`parseMergeSnapshot`); unaffected by the column type.
9. **`follow_up_queue_item` reads** (`queueQueries.ts`
   `readQueueRows`) are typed; `last_touch_at` comes back as a real `Date`.
   `appShellBadgeCountsQuery` compares only `queue_date`/`state`/activity
   times. No change.
10. **Remaining session-TimeZone dependencies after this slice:** none on a
    timestamp column. The TimeZone gate (`scripts/check-session-timezone.ts`)
    stays as a cheap regression check but no longer protects any known query.

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
  The journal now has 34 entries (idx 0..33), so prod should report **33**
  applied before this slice runs. 34 means slice 6 was already applied; fewer
  than 33 means an earlier slice is unapplied — investigate first.

## Required sequence (do not reorder)

1. **Merge the PR to `main`.** Wait for the Vercel production deployment to
   reach **Ready**. New code against still-naive columns is harmless on the
   UTC runtime. Record the deployed commit SHA in the checklist.

2. **Capture the before-state** (read-only, against production):
   ```sql
   select table_name, column_name, data_type, is_nullable from information_schema.columns
   where (table_name = 'person_bd_connection' and column_name in ('first_message_at', 'last_message_at', 'created_at'))
      or (table_name = 'email_account' and column_name in ('last_synced_at', 'reconnect_banner_dismissed_at', 'connected_at', 'disconnected_at', 'updated_at'))
      or (table_name = 'email_message' and column_name in ('sent_at', 'created_at'))
      or (table_name = 'follow_up_queue_item' and column_name in ('last_touch_at', 'created_at', 'updated_at'))
   order by table_name, column_name;

   select tablename, count(*) from pg_indexes
   where tablename in ('person_bd_connection', 'email_account', 'email_message', 'follow_up_queue_item')
   group by tablename;

   select max(first_message_at), max(last_message_at), max(created_at),
          min(first_message_at), min(last_message_at), min(created_at) from person_bd_connection;
   select max(sent_at), max(created_at), min(sent_at), min(created_at) from email_message;
   select max(last_touch_at), max(created_at), max(updated_at),
          min(last_touch_at), min(created_at), min(updated_at) from follow_up_queue_item;
   select * from email_account;  -- 2 rows; record every timestamp by eye
   ```

   Then the **type-stable fingerprints**. Run ALL FOUR in ONE session (one
   `psql` connection, or one postgres.js `sql.reserve()`/`sql.begin`), starting
   with the `set`. The session is pinned to UTC so a naive `::timestamptz` and
   a `timestamptz::timestamptz` both render `YYYY-MM-DD HH:MM:SS.ffffff+00`
   (state-independent). Every statement selects
   `current_setting('TimeZone')` and `count(*)` in the SAME statement as the
   hash: a pooler that silently drops the `set` shows up as a non-`UTC` value
   next to the hash, and a row silently skipped by `string_agg` shows up as a
   count that disagrees with `select count(*)` of the table.

   **Every nullable column's text is wrapped in `coalesce(..., 'null')`.** A
   single NULL would otherwise make the whole row's `||` concatenation NULL
   and `string_agg` would silently skip that row — weakening the proof with
   no visible signal. The nullable columns here are
   `person_bd_connection.first_message_at` / `last_message_at` and
   `email_account.last_synced_at` / `reconnect_banner_dismissed_at` /
   `disconnected_at`. (`last_touch_at` is `notNull`; all others are `notNull`
   too.) Ordering keys are unique: `person_bd_connection`'s primary key is the
   composite `(person_id, bd_id)`, so BOTH parts are in the `order by`;
   `email_account`'s primary key is `bd_id`; the other two use `id`.

   ```sql
   set time zone 'UTC';

   select current_setting('TimeZone') as tz, count(*) as n,
          md5(string_agg(person_id::text || '|' || bd_id::text
                         || '|' || coalesce(first_message_at::timestamptz::text, 'null')
                         || '|' || coalesce(last_message_at::timestamptz::text, 'null')
                         || '|' || created_at::timestamptz::text,
                         ',' order by person_id, bd_id)) as fp
   from person_bd_connection;

   select current_setting('TimeZone') as tz, count(*) as n,
          md5(string_agg(bd_id::text
                         || '|' || coalesce(last_synced_at::timestamptz::text, 'null')
                         || '|' || coalesce(reconnect_banner_dismissed_at::timestamptz::text, 'null')
                         || '|' || connected_at::timestamptz::text
                         || '|' || coalesce(disconnected_at::timestamptz::text, 'null')
                         || '|' || updated_at::timestamptz::text,
                         ',' order by bd_id)) as fp
   from email_account;

   select current_setting('TimeZone') as tz, count(*) as n,
          md5(string_agg(id::text
                         || '|' || sent_at::timestamptz::text
                         || '|' || created_at::timestamptz::text,
                         ',' order by id)) as fp
   from email_message;

   select current_setting('TimeZone') as tz, count(*) as n,
          md5(string_agg(id::text
                         || '|' || last_touch_at::timestamptz::text
                         || '|' || created_at::timestamptz::text
                         || '|' || updated_at::timestamptz::text,
                         ',' order by id)) as fp
   from follow_up_queue_item;
   ```
   Each `tz` must read `UTC` and each `n` must equal the table's own
   `select count(*)` (about 21,459 / 2 / 307 / 20 at the time of writing).
   Use exactly these forms in both the before and after captures. Do NOT
   replace them with a concatenation of the raw column: the text rendering
   differs between the two types and the comparison would be meaningless.

   Also run the **TimeZone gate** and capture the **full won-drilldown dump**
   and the **per-BD report**:

   ```
   DATABASE_URL="<prod connection string>" npx tsx scripts/check-session-timezone.ts
   DATABASE_URL="<prod connection string>" TZ=UTC npx tsx scripts/dump-won-drilldown.ts > won-drilldown.slice6.before.json
   ```
   The gate must exit 0 and print `UTC`; if it does not, STOP before step 3.
   For this slice's own wire-shape evidence, capture one row through the
   app's client (read-only), before and after:
   ```sql
   select bd_id, connected_at from email_account order by bd_id limit 1;
   ```
   Expect `2026-09-29 23:50:17.913289` before and `...+00` after, parsing to
   the identical instant.

   Record the results here before continuing:
   `<PASTE BEFORE-STATE RESULTS HERE>`

   Pre-flight figures to cross-check against (owner-supplied):
   - `person_bd_connection` rows / size / indexes: `TO BE FILLED FROM PRE-FLIGHT` (21,459 / 4960 kB / 2)
   - `email_message` rows / size / indexes: `TO BE FILLED FROM PRE-FLIGHT` (307 / 1008 kB / 4)
   - `follow_up_queue_item` rows / size / indexes: `TO BE FILLED FROM PRE-FLIGHT` (20 / 64 kB / 3)
   - `email_account` rows / size / indexes: `TO BE FILLED FROM PRE-FLIGHT` (2 / 48 kB / 2)
   - `select count(*) from drizzle.__drizzle_migrations`: `TO BE FILLED FROM PRE-FLIGHT`
   - TimeZone gate (the app's pooled connection): `TO BE FILLED FROM PRE-FLIGHT` (must read `UTC`)
   - Any long-running transaction or open lock on the four tables (the Gmail
     sync cron holds `email_account`/`email_message`; check
     `pg_stat_activity` and avoid its tick): `TO BE FILLED FROM PRE-FLIGHT`

3. **Apply the migration to production** by hand:
   ```
   DATABASE_URL="<prod connection string>" npm run db:migrate
   ```
   `SET LOCAL lock_timeout = '2s'` is the first statement of
   `0033_timestamptz_slice_6.sql`. Be precise about what that buys: a blocked
   `ALTER` does NOT step aside — it waits in the lock queue for up to 2
   seconds, and new reads and writes on that table queue BEHIND it for that
   long. After 2 seconds it aborts the transaction cleanly and nothing
   changed. `lock_timeout` applies per lock acquisition, so the locks already
   taken on earlier tables stay held while it waits on a later one: a stall
   of several seconds across the 4 tables is possible, bounded but real.
   If it aborts on the lock, nothing changed; retry at a quieter moment.
   The four tables are locked together until commit, so do it off-peak and
   away from the Gmail sync cron.

4. **Run the verification queries** below and compare with step 2.

## Verification (run after step 3)

Re-run the step 2 queries and confirm:

- `data_type` for all 13 columns changes from `timestamp without time zone`
  to `timestamp with time zone`; `is_nullable` unchanged.
- The index counts (2 / 4 / 3 / 2) are unchanged.
- `max`/`min` of every column are the same instants (not shifted).
- All four `md5` fingerprints are IDENTICAL to the before values, each `tz`
  reads `UTC`, and each `n` is unchanged.
- `check-session-timezone.ts` still exits 0 with `UTC`.
- Re-run the dump and diff it against the before capture:
  ```
  DATABASE_URL="<prod connection string>" TZ=UTC npx tsx scripts/dump-won-drilldown.ts > won-drilldown.slice6.after.json
  diff won-drilldown.slice6.before.json won-drilldown.slice6.after.json
  ```
  Expected: **no output.**

**The check that matters is typed Drizzle reads returning valid `Date`s plus
the raw reads that parse strings** — the failure mode is `Invalid Date`, not
data loss. Read-only, from a one-off `tsx` against prod:

```ts
import { desc } from "drizzle-orm";
import { db } from "./src/db";
import { emailAccount, emailMessage, followUpQueueItem, personBdConnection } from "./src/db/schema";

const ok = (d: unknown) => d instanceof Date && !Number.isNaN(d.getTime());
const [a] = await db.select({ c: emailAccount.connectedAt, u: emailAccount.updatedAt, s: emailAccount.lastSyncedAt }).from(emailAccount).orderBy(desc(emailAccount.connectedAt)).limit(1);
console.log("email_account:", a, ok(a?.c), ok(a?.u), ok(a?.s) || a?.s === null);
const [m] = await db.select({ s: emailMessage.sentAt, c: emailMessage.createdAt }).from(emailMessage).orderBy(desc(emailMessage.sentAt)).limit(1);
console.log("email_message:", m, ok(m?.s), ok(m?.c));
const [q] = await db.select({ t: followUpQueueItem.lastTouchAt, c: followUpQueueItem.createdAt, u: followUpQueueItem.updatedAt }).from(followUpQueueItem).orderBy(desc(followUpQueueItem.createdAt)).limit(1);
console.log("follow_up_queue_item:", q, ok(q?.t), ok(q?.c), ok(q?.u));
const [p] = await db.select({ f: personBdConnection.firstMessageAt, l: personBdConnection.lastMessageAt, c: personBdConnection.createdAt }).from(personBdConnection).orderBy(desc(personBdConnection.lastMessageAt)).limit(1);
console.log("person_bd_connection:", p, ok(p?.f), ok(p?.l), ok(p?.c));
```

Then exercise the changed/affected raw readers through the app's own
functions (arguments exact), comparing counts before and after the migration
(all read-only; do NOT call `ensureTodayFollowUpQueue` or
`getFollowUpQueuePage`, which can materialize rows):

- `getReportPerBd({ fromIso: "2026-09-01T03:00:00.000Z", toIso: "2026-10-01T03:00:00.000Z", fromDate: "2026-09-01", toDateExclusive: "2026-10-01", bdId: null })`
  (`src/lib/reports/queriesDb.ts`) — the hazard-3 change. Capture BEFORE the
  migration but AFTER the code deploy, and again after: `queueWorked`,
  `queuePostponed`, `queueSkipped`, `queueStillPending` must be identical for
  every BD. To prove the rewrite is value-neutral, also capture it from the
  PREVIOUS deploy's code (or compare with the pre-merge numbers) once.
- `db.execute(buildFollowUpVerificationQuery())`
  (`src/lib/followUp/candidateQuery.ts`) — same `owner_bd_id`/
  `eligible_count`/`queue_count` rows before and after.
- `db.execute(buildDefaultPipelineStageCandidatesQuery())`
  (`src/lib/companies/defaultPipelineStageQuery.ts`) — same row count and the
  same `has_recent_qualifying_contact` count before and after.
- `listOutreachCandidates(<bdId>, {}, 1, 25)` (`src/lib/outreach/queries.ts`)
  — every `lastMessageAt` a valid `Date`, same ordering and dormant flags.
- `getAppShellBadgeCounts(<bdId>, new Date())`
  (`src/lib/shell/appShellBadgeCounts.ts`) — same `taskCount`, `followUpCount`
  and `needsReconnectBanner` as before.
- `getWonCompaniesDrilldown({ bdId: null })` — the dump diff above.
- The record page timeline for a person with a Gmail thread
  (`/contacts/<personId>`) — message `sentAt` values render the same times.

If anything prints `Invalid Date` at any point, STOP: some deployed instance
disagrees with the DB about the column type.

## If verification fails, or the deploy in step 1 needs to be undone

Forward-only, in this order:

1. Redeploy the previous production code (the commit before this branch, so
   `schema.ts` has plain `timestamp` for these four tables again) FIRST.
2. Only then apply the rollback by hand as ONE transaction:
   ```
   psql --single-transaction "$DATABASE_URL" -f drizzle/0033_timestamptz_slice_6_rollback.sql
   ```
   or a postgres.js script running the whole file inside
   `sql.begin(async (sql) => { ... })`. Never plain autocommit `psql -c`.
3. Re-run the verification queries and confirm `data_type` is back to
   `timestamp without time zone` with the same counts, instants and
   fingerprints.

## Owner approval

- [ ] Pre-flight numbers filled into this document (every
      `TO BE FILLED FROM PRE-FLIGHT`)
- [ ] Dry run reviewed (this document + the diff on `feat/timestamptz-slice-6`)
- [ ] Owner approved production execution
- [ ] PR merged to `main`; production deploy reached Ready — commit SHA
      recorded here: `<PASTE COMMIT SHA HERE>`
- [ ] `select count(*) from drizzle.__drizzle_migrations` reports 33
- [ ] `scripts/check-session-timezone.ts` exited 0 (`UTC`) and its output is recorded
- [ ] Before-state queries, all four fingerprints (each with `tz = UTC` and the
      expected `n`), the per-BD report and `won-drilldown.slice6.before.json` captured and recorded above
- [ ] `DATABASE_URL=... npm run db:migrate` executed against production
- [ ] Verification queries confirm the migration (step 4), including all four identical `md5` fingerprints
- [ ] `diff won-drilldown.slice6.before.json won-drilldown.slice6.after.json` is empty
- [ ] Typed-Drizzle-read checks (four tables) AND the raw-reader checks print valid `Date`s and unchanged counts
