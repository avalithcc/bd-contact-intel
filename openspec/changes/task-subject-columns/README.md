# task-subject-columns: what to do with `task.lead_id` and `task.contact_id`

Status: RECOMMENDATION ONLY. Nothing here is applied, nothing is in the Drizzle
journal, `src/db/schema.ts` is untouched. Dropping a column is irreversible in
production; the owner decides.

Investigated on `main` at `6ae2fd8`. No database access was used; the only
production figure is the owner's own measurement (0 of 20 `task` rows have
`lead_id` set). Everything else is code evidence (`file:line`).

## Recommendation: (b) drop both columns, in two steps

`task.lead_id` and `task.contact_id` are the same problem and share one fix.
Both are pre-Unified-Contact subject keys, both are superseded by
`task.person_id`, and neither can be reached by a user. Do not build a write
path (a): there is nothing the product needs that `person_id` and
`company_key` do not already cover (section 1).

1. **Code PR first, columns stay.** Remove the dead plumbing (section 3) so
   nothing in the app mentions either column. Safe and trivially revertible.
   Roughly 25 production lines deleted, none added.
2. **Migration second, after the owner approves.** Drop both columns with the
   guarded SQL in section 6. Order matters: the migration must not ship before
   the code PR, because the fold/catch-up raw SQL (section 3, items 5 and 6)
   would start failing.

Scope is `task` only. The twins `activity.lead_id`, `signal.lead_id` and the
`contact_id` columns on `activity`, `signal` and `linkedin_scrape_job` are NOT
dead (section 4) and must not be dragged into this change.

## 1. What a task attaches to today

Schema, `src/db/schema.ts:1166-1200`, table `task`:

| Column | Line | FK | Written by the app? | Reachable by a user? |
| --- | --- | --- | --- | --- |
| `person_id` | 1177 | `person.id`, cascade | yes, every path | yes (record page, bulk, /tasks dialog) |
| `company_key` | 1172 | `company.company_key`, cascade | yes | yes (company page, /tasks dialog) |
| `lead_id` | 1171 | `lead.id`, cascade | **no** | no |
| `contact_id` | 1175 | none (legacy `contact`) | **no** | no |

`resolveTaskSubject` (`src/lib/tasks/subject.ts`) knows exactly two subjects,
`personId` then `companyKey`; `TaskSubjectInput` has neither `leadId` nor
`contactId`. Its own doc comment states the model: "Every task belongs to
exactly one Contact (`personId`) or one Company (`companyKey`)".

Write paths, all verified:

- `createTaskAction` (`src/app/(app)/tasks/actions.ts:23-52`) declares
  `leadId?` and `contactId?` and spreads `input` into `createTask`. No caller
  passes them. Callers: `NewTaskButton.tsx:127` (subject picker, person or
  company only; `subjectSearch.ts` has no lead branch),
  `contacts/actions.ts:196` (`personId`), `companies/actions.ts:166`
  (`companyKey`).
- Bulk create (`src/lib/tasks/bulkCreate.ts`) builds rows with `personId` only;
  its header says so explicitly.
- Edit (`updateWithActivity.ts`) never reassigns a subject; `queries.ts`
  (comment above `deleteTask`) records that "Asociado con" is read-only by
  mockup decision.
- `createTask` (`queries.ts:464-469`) does resolve a legacy id to a `person_id`
  through `resolvePersonIdLookup` (`src/lib/identity/referenceWrite.ts:27-31`),
  but only if a caller supplies `leadId`/`contactId`, and none does.

A task on a lead is already expressible as a task on that lead's person:
`importLeads` dual-writes `person` and `person_id_map` (`lead` -> `person`)
under `IDENTITY_DUAL_WRITE` (`src/lib/leads/queries.ts:90-135`,
`src/lib/identity/ingestWrite.ts`), and `/leads/[id]` redirects through that
map (`src/app/(app)/leads/[id]/page.tsx:22-26`). So `lead_id` carries no
information `person_id` cannot. The one hole is a lead with no owner: the
ingest skips it (`leadsSkippedNoOwner`, `src/lib/migration/catchUpPlanner.ts`),
so it has no person, no `/contacts` record, and therefore no UI from which a
task could be created anyway. That is an ingest question, not a task-column
question.

## 2. Is `lead` still a live concept?

**As a model that users read: dead. As an ingest staging table: still live.
It is being wound down by design, but the wind-down is not finished.**

Dead (no reader reaches a user):

- `/leads` and `/leads/[id]` are redirect-only
  (`src/app/(app)/leads/page.tsx:26-29`, `[id]/page.tsx:22-26`). Plan of
  record: `openspec/changes/crm-hubspot-ux/tasks.md` items 11.4, 13.3, 14d3;
  the spec keeps legacy `lead`/`contact` read-only "until verification"
  (`specs/contact-migration/spec.md:71`).
- `listLeads`, `getLeadById`, `getLeadFilterOptions`, `updateLeadStatus`,
  `updateLeadOwner` (`src/lib/leads/queries.ts:273,365,432,459,505`) have
  **zero callers** in `src`, `scripts` and `tests` (only comments mention
  them). The lead-detail server actions were deleted for that reason
  (`src/app/(app)/leads/actions.ts:85-91`).
- There is **no** lead-to-contact conversion path. Confirmed:
  `convertLead|promoteLead|leadToCompany|fromLead` match nothing. The
  conversion that exists is the one-time `fold_leads` migration plus the live
  dual-write; both are `lead` -> `person`.

Still live (writes, not reads):

- `importLeads` is called by the `/contacts/import` upload form
  (`src/app/(app)/contacts/import/page.tsx:46` -> `leads/actions.ts`), by the
  bearer-protected `POST /api/leads/ingest`
  (`src/app/api/leads/ingest/route.ts:6`) used by the external `lead_gen`
  repo, and by `scripts/import-leads.ts:30`. It upserts `lead`, then
  dual-writes `person`.
- `signal.lead_id` is still written (`src/lib/contacts/manualSignalDb.ts:29`,
  `src/app/api/signals/manual/route.ts:33-37`); `activity.lead_id` has a
  reader (`src/lib/migration/queries.ts:366-368`) and a writer path
  (`src/lib/gmail/send.ts:134`, always `undefined` today).
- The migration tooling reads `lead` (`catchUpQueries.ts:107,137`,
  `migration/queries.ts:323`) and `BACKUP_TABLES` lists it (`backup.ts:26`).
- Production: 1057 `fi-arg-2026` rows plus one test row (owner measurement).

So `lead` is legacy, not load-bearing for any screen, but its ingest door is
open. That is why `lead` itself must NOT be dropped in this change, and why it
does not argue for a task write path: nothing reads a lead as a thing a task
hangs off.

## 3. Everything that reads `task.lead_id` and `task.contact_id`

The backlog says "indexes, joins and rendering". Measured: indexes yes; joins
no; rendering no. No `.tsx` file references either column (`rg` for
`leadId|lead_id` over `src/**/*.tsx` returns nothing), and no query joins
`task` to `lead`. The only joins on `task` are `bd`, `person` and `company`
(`src/lib/tasks/queries.ts:57-63`). So there are no dead UI branches to remove;
the dead code is all server-side plumbing:

1. `src/db/schema.ts:1171` `leadId`, `:1175` `contactId`.
2. `src/db/schema.ts:1196` `task_lead_idx`, `:1198` `task_contact_idx`; FK
   `task_lead_id_lead_id_fk` (`drizzle/0012_fantastic_iceman.sql:106`,
   cascade); indexes at `0012:136,138`.
3. `src/lib/tasks/queries.ts`: `TaskFilters.leadId`/`contactId` (`:18,20`);
   `taskSubjectSelect` (`:40,42`); `getTasks` filters (`:81-91`);
   `TaskWindowRow` (`:211,213`); `toTaskRow` (`:252,254`); raw SQL in
   `getTasksForPerson` (`:325,327`). **`getTasks` has zero callers**, so its
   filters are unreachable.
4. `src/app/(app)/tasks/actions.ts:26,28`: `createTaskAction` input type.
   (`revalidatePath("/leads")` at `:50` and `:62` is also dead since `/leads`
   is a redirect; harmless.)
5. `src/lib/migration/queries.ts:520-531` (`finalizeFoldExecute`): raw
   `UPDATE task ... WHERE m.legacy_id = r.lead_id`. **Breaks on drop.**
6. `src/lib/migration/catchUpQueries.ts:215-229` (`finalizeCatchUpExecute`):
   raw `UPDATE task ... r.contact_id ... r.lead_id`. **Breaks on drop.**
7. `src/lib/identity/referenceWrite.ts:27-31` `resolvePersonIdLookup`: shared
   with activity and signal, so it stays; `createTask` just stops being able to
   resolve a legacy id.
8. Comment only: `bulkCreate.ts:16`. Types: `TaskRow extends Task`, so both
   fields ride on every `Task` object. No test builds a task with either field
   (`rg` over `tests` finds none), so the unit suite needs no change.

Items 5 and 6 are the trap. Both are execute-time raw SQL for one-shot,
already-run migration phases (`collapse` and `fold_leads` executed; `catch_up`
exists only as an approved dry run and per 4B.10 is not needed). A dropped
column makes a future `--execute` throw. Fix in the code PR by removing `task`
from the `[activity, task, signal]` loops (leave `activity` and `signal`) and
note in `crm-hubspot-ux/tasks.md` that task re-pointing is complete.
`BACKUP_TABLES` lists whole tables, not columns, so it is unaffected.

## 4. Are `contact_id` and `lead_id` the same problem? Yes on `task`; no elsewhere

The backlog entry "task.contactId" says both are "pre-Unified-Contact legacy
columns superseded by `personId`". Confirmed. On `task` they are identical in
shape: never written, never rendered, only selected and (for the fold/catch-up
SQL) repointed. One migration should drop both; otherwise the twin is left
behind and the next investigation repeats this one.

One difference: `contact_id` has no FK (`schema.ts:1175`, plain `uuid`), so
nothing cascades from it and dropping it only removes `task_contact_idx`.

Do NOT generalize to the other tables:

- `signal.lead_id` is actively written (`manualSignalDb.ts:29`) and read by the
  fold/catch-up SQL. Live.
- `activity.lead_id` / `contact_id` have readers (`migration/queries.ts:366`,
  `src/lib/activity/queries.ts:73-74,112-118`). Out of scope; revisit when
  `lead` itself is retired.
- `linkedin_scrape_job.contact_id` belongs to a different feature.

## 5. Why not (a), or "(c) build a picker"

- (a) needs a requirement. The only one in the backlog is "full schema, no write
  path"; that is a symptom, not a need. A lead task is a person task.
- Building it forks the model: two ways to attach a task to the same human
  (`lead_id` and `person_id`), and `resolvePersonIdLookup` gives `contactId`
  precedence over `leadId` with an unstated "shouldn't happen"
  (`referenceWrite.ts:21-26`). That ambiguity would become reachable.
- The `ON DELETE CASCADE` on `task.lead_id` is a live hazard the day anyone
  writes it: deleting a `lead` row (or its `lead_source`, itself cascading,
  `schema.ts:557`) would silently delete tasks. Dropping the column removes
  that exposure.
- Honest uncertainty: I did not measure how many of the 1057 leads have no
  person (owner-less). If that number is large and the owner wants tasks on
  them, the right fix is to give those leads an owner at ingest, not to add a
  `lead_id` write path.

## 6. Migration SQL (written, NOT applied, NOT in the journal)

Whoever applies this:

- Generate it with `drizzle-kit` after the code PR removes both fields from
  `schema.ts`, so the `drizzle/meta/00NN_snapshot.json` is produced rather than
  hand-written, then use the guard below as the migration body. Pick `00NN` as
  the next free number at that time (another migration was in flight when this
  was written; this document reserves no number).
- The journal is future-dated: the last entry is `0035_bd_signature_html` with
  `when` = 1792527871556 (about 2026-10-20). The new entry's `when` must be
  hand-set **greater than that** (`tests/unit/drizzleJournal.test.ts` enforces
  it). Re-read the journal on the day; it may have moved.
- Follow the gate: dry run (the preflight below), owner approval, then execute.

Preflight (read-only, run first; the two counts must be 0):

```sql
SELECT count(*) FILTER (WHERE lead_id IS NOT NULL)    AS lead_id_set,
       count(*) FILTER (WHERE contact_id IS NOT NULL) AS contact_id_set,
       count(*)                                       AS total
FROM "task";
```

Migration (`drizzle/00NN_drop_task_legacy_subjects.sql`):

```sql
-- Refuse to run if any row still carries a legacy subject. Dropping the
-- column would destroy that data and the rollback cannot restore values.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "task" WHERE "lead_id" IS NOT NULL OR "contact_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'task.lead_id / task.contact_id still hold data; refusing to drop';
  END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "task_lead_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "task_contact_idx";--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_lead_id_lead_id_fk";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "lead_id";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "contact_id";
```

Cost: `task` is about 20 rows; `DROP COLUMN` takes a brief ACCESS EXCLUSIVE lock
and does not rewrite the table. Run it in a quiet moment anyway, because the
app reads `task` on every page through the sidebar badge count. Take a
Supabase backup or a `BACKUP_TABLES` snapshot first, as for any schema change.

Rollback (`drizzle/00NN_drop_task_legacy_subjects_rollback.sql`, not in the
journal, same convention as `0035_bd_signature_html_rollback.sql`). It restores
the structure exactly as `0012` created it. It cannot restore values, which is
why the guard requires them to be NULL first:

```sql
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "contact_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_lead_id_lead_id_fk"
   FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_lead_idx" ON "task" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_contact_idx" ON "task" USING btree ("contact_id");
```

Run the rollback only after reverting the code PR, or the old code will not
find the fields it selects.

## 7. Sequencing and owner decisions

1. Approve (b).
2. Code PR: remove section 3 items 1, 3, 4, 5, 6 and the comment in 8 (leave
   the index and FK lines for the migration); keep the columns.
3. Re-run the preflight against production.
4. Owner approves; generate and apply the migration.
5. Update `openspec/BACKLOG.md`: replace the `task.leadId` and `task.contactId`
   entries and correct the "joins and rendering" wording (section 3).

Owner decisions needed: (i) approve the drop; (ii) whether owner-less leads
matter (section 5); (iii) timing relative to the `timestamptz` slice 5 work,
which also alters `task` (`openspec/decisions/2026-10-01-timestamptz-slice-5-runbook.md`)
and should not run concurrently with this DDL.
