# Runbook — timestamptz migration, slice 2

Prepared 2026-09-30 on branch `feat/timestamptz-slice-2`. Planning only —
nothing has been applied to production. Read
`openspec/decisions/2026-09-30-timestamptz-migration-plan.md` first,
especially the (now-corrected) "Required sequence" section — this runbook
exists to enforce that exact sequence for slice 2.

Scope: `job_posting` (4 columns: `posted_at`, `first_seen`, `last_seen`,
`closed_at`), `contact` (3 columns: `first_message_at`, `last_message_at`,
`created_at`), `conversation` (3 columns: `first_message_at`,
`last_message_at`, `created_at`), `message` (2 columns: `sent_at`,
`created_at`) — 12 columns across 4 tables. Measured against production
2026-09-30: `job_posting` 7,321 rows / 3.4 MB / 6 indexes, `contact` 20,388
rows / 15 MB / 11 indexes, `conversation` 6,081 rows / 4.0 MB / 4 indexes,
`message` 39,753 rows / 23 MB / 3 indexes. The index counts match the schema
exactly (PK + unique constraint + explicit indexes for every table); row
counts and byte sizes were not independently re-measured here (no database
access in this worktree) and should be confirmed as part of the before-state
capture below.

Unlike slice 1, these tables are NOT low-traffic: `contact`, `conversation`
and `message` back the LinkedIn conversation history (the contact record's
"Historial de conversaciones" card and the outreach message generator's
history-aware prompt), and `job_posting` backs the /hiring and /outreach
pages plus Novedades (`/whats-new`).

## Why the sequence is inverted from slice 1 (read this before running anything)

Slice 1's runbook required a preview build + `vercel promote` dance to keep
the "old code / new column" window to a few seconds, because the plan
*assumed* `vercel promote` was instant. It is not — it builds a new
production deployment, which took ~90 seconds in practice. The real
code/schema mismatch window during slice 1 was closer to 100 seconds, not
the few seconds the runbook promised. It was harmless only because it ran at
23:54 UTC (21:00 ART) with nobody working.

Measured directly against production on the still-unmigrated
`job_posting.first_seen` (a `timestamp without time zone` column holding a
UTC value) on 2026-09-30:

```
columna real:          timestamp without time zone
valor crudo:           2026-09-30 09:42:27.365516
withTimezone: false -> 2026-09-30T09:42:27.365Z
withTimezone: true  -> 2026-09-30T09:42:27.365Z   (identical)
```

New code (`withTimezone: true`) reading an old, still-naive column produces
the SAME instant as old code reading it — on a UTC runtime (Vercel prod),
`PgTimestamp.mapFromDriverValue`'s "parse the offset-less string in the
process timezone" branch is a no-op, because the process timezone already
IS UTC. So on this platform, new-code-against-old-column is harmless. Only
the opposite mismatch (old code, new `timestamptz` column) breaks, by
appending `+0000` to a string that already carries an offset, producing
`Invalid Date`.

**Slice 2 therefore inverts the sequence: merge and deploy the code to
production FIRST, wait for Ready, and only then apply the migration. There
is no broken window at all** — at no point does old code face a migrated
column. No preview build, no `vercel promote`.

This asymmetry is specific to Vercel prod running `TZ=UTC`. It does NOT hold
on a non-UTC runtime, where new-code-against-old-column would parse
offset-less strings in the wrong local timezone. See the updated migration
plan's "Required sequence" section for the general rule.

## Files this runbook uses

- Forward migration (in the drizzle journal, `drizzle/meta/_journal.json`
  idx 29): `drizzle/0029_timestamptz_slice_2.sql`
- Rollback (deliberately NOT in the journal — see that file's header
  comment): `drizzle/0029_timestamptz_slice_2_rollback.sql`

## Operational gotchas learned during slice 1 (apply here too)

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
  This should equal the journal's entry count MINUS ONE (idx 0..29 is 30
  entries; before this slice runs, prod should report 29 applied — i.e.
  everything through idx 28/slice 1). If it already reports 30, slice 2 was
  already applied; if it reports fewer than 29, an earlier slice has not
  been applied and must be investigated before proceeding.

## Required sequence (do not reorder)

1. **Merge the PR to `main`.** The production deploy builds from `main`
   automatically. Wait for the Vercel deployment to reach **Ready** before
   continuing — this is new code (`withTimezone: true`) running against the
   still-unmigrated (naive `timestamp`) columns, which is harmless on
   Vercel's UTC runtime (see "Why the sequence is inverted" above). No
   preview build, no promote — this is a normal `git push`-triggered
   production deploy.

2. **Capture the before-state** (read-only, run against production):
   ```sql
   select column_name, data_type from information_schema.columns
   where table_name in ('job_posting', 'contact', 'conversation', 'message')
   order by table_name, column_name;

   select 'job_posting' as t, count(*) from job_posting
   union all select 'contact', count(*) from contact
   union all select 'conversation', count(*) from conversation
   union all select 'message', count(*) from message;

   select tablename, count(*) from pg_indexes
   where tablename in ('job_posting', 'contact', 'conversation', 'message')
   group by tablename;

   select max(first_seen) from job_posting;
   select max(created_at) from contact;
   select max(created_at) from conversation;
   select max(sent_at) from message;
   ```
   Record the results here before continuing:
   `<PASTE BEFORE-STATE RESULTS HERE>`

3. **Apply the migration to production** by hand:
   ```
   DATABASE_URL="<prod connection string>" npm run db:migrate
   ```
   `SET LOCAL lock_timeout = '2s'` is the first statement in
   `0029_timestamptz_slice_2.sql`, so a blocked `ALTER` aborts the whole
   transaction within 2 seconds instead of queuing and starving the
   3-connection production pool. Because the code deployed in step 1
   already declares `withTimezone: true` for all 12 columns, there is no
   window — before this commits, every typed read already got the correct
   instant off the naive column; after it commits, every typed read gets
   the correct instant off the `timestamptz` column.

4. **Run the verification queries** below against production and confirm
   the counts/instants match what was recorded in step 2.

## Verification (run after step 3)

Re-run the three `information_schema`/count/index/`max(...)` queries from
step 2 and confirm:

- `data_type` for all 12 columns listed above changes from `timestamp
  without time zone` to `timestamp with time zone`.
- `count(*)` for all four tables is unchanged.
- The index count per table is unchanged (`job_posting` 6, `contact` 11,
  `conversation` 4, `message` 3).
- Each `max(...)` instant is unchanged (same ISO instant, not shifted).

**The check that actually matters is a typed Drizzle read returning a valid
`Date`, not a row count — the failure mode this migration guards against is
`Invalid Date`, not data loss.** One read per table, run from a Node REPL or
a one-off `tsx` invocation against prod (read-only, no writes):

```ts
import { desc } from "drizzle-orm";
import { db } from "./src/db";
import { jobPosting, contact, conversation, message } from "./src/db/schema";

const jp = await db.select({ firstSeen: jobPosting.firstSeen })
  .from(jobPosting).orderBy(desc(jobPosting.firstSeen)).limit(1);
console.log("job_posting.first_seen:", jp[0]?.firstSeen, jp[0]?.firstSeen instanceof Date);

const c = await db.select({ createdAt: contact.createdAt })
  .from(contact).orderBy(desc(contact.createdAt)).limit(1);
console.log("contact.created_at:", c[0]?.createdAt, c[0]?.createdAt instanceof Date);

const cv = await db.select({ lastMessageAt: conversation.lastMessageAt })
  .from(conversation).orderBy(desc(conversation.lastMessageAt)).limit(1);
console.log("conversation.last_message_at:", cv[0]?.lastMessageAt, cv[0]?.lastMessageAt instanceof Date);

const m = await db.select({ sentAt: message.sentAt })
  .from(message).orderBy(desc(message.sentAt)).limit(1);
console.log("message.sent_at:", m[0]?.sentAt, m[0]?.sentAt instanceof Date);
```

Expect all four `instanceof Date` checks to print `true` and the printed
value to be a real date (NOT the string `Invalid Date`), both before step 1
(already true today, against the naive columns) and after step 3 (now true
against the `timestamptz` columns). If any of them print `Invalid Date` at
any point, STOP — that is the deploy-order hazard, and it means some
deployed instance of the code disagrees with the DB about these columns'
type.

## If verification fails, or the deploy in step 1 needs to be undone

Roll back in this order (per the plan's "Rollback" note — forward-only,
never edit an applied migration):

1. Redeploy the previous production code (the commit before this branch, so
   `schema.ts` has `withTimezone: false` for these 12 columns again) FIRST.
2. Only then apply `drizzle/0029_timestamptz_slice_2_rollback.sql` to
   production by hand, as ONE transaction:
   ```
   psql --single-transaction "$DATABASE_URL" -f drizzle/0029_timestamptz_slice_2_rollback.sql
   ```
   or a small postgres.js script that runs the whole file inside
   `sql.begin(async (sql) => { ... })`. Never run it with plain autocommit
   `psql -c` one statement at a time.
3. Re-run the verification queries above and confirm `data_type` is back to
   `timestamp without time zone` with the same counts/instants.

## Owner approval

- [ ] Dry run reviewed (this document + the diff on
      `feat/timestamptz-slice-2`)
- [ ] Owner approved production execution
- [ ] PR merged to `main`; production deploy reached Ready — commit SHA
      recorded here: `<PASTE COMMIT SHA HERE>`
- [ ] Before-state queries (step 2) run and recorded above
- [ ] `DATABASE_URL=... npm run db:migrate` executed against production
- [ ] Verification queries confirm the migration (step 4)
- [ ] All four typed-Drizzle-read checks print a valid `Date`, not `Invalid
      Date`
