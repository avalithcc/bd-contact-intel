/**
 * Re-applies the fixed role classifier (src/lib/roleGroups.ts) to the stored
 * values it feeds: `person.role_group` and `job_posting.is_it`. The fix is
 * structural (parentheticals and incidental words no longer decide; leader-first
 * titles like "Manager, Field Engineering" are understood; a bare VP or partner
 * no longer wins), so the scope is EVERY non-merged person and EVERY posting:
 * no title list can enumerate what it touches. `--title-regex=<postgres regex>`
 * narrows both tables (`~*`) when a run must stay small.
 *
 * Persons with a human `roleGroup` edit (person_property_history, property
 * 'roleGroup', source 'edit') are never touched and are counted.
 *
 * Dry run is the default: it reads and prints COUNTS only (role-group
 * distribution before/after, transitions, is_it flips). `--execute --actor=<bd id>`
 * runs ONE transaction: batched bulk UPDATEs for both tables, a read-back of
 * every written row (a mismatch throws and rolls everything back), and ONE
 * `audit_log` row (action `backfill_role_classifier_development`) holding
 * every changed id with its before and after. Refuses to execute above
 * MAX_CHANGES total rows. `person.updated_at` is left alone (derived cache).
 *
 * Revert (ids and old values are in the audit metadata):
 *   update person p set role_group = c."from"
 *   from audit_log a, jsonb_to_recordset(a.metadata->'persons'->'changes') as c(id uuid, "from" text, "to" text)
 *   where a.id = '<audit id>' and p.id = c.id and p.role_group = c."to";
 *   update job_posting j set is_it = c."from"
 *   from audit_log a, jsonb_to_recordset(a.metadata->'postings'->'changes') as c(id uuid, "from" boolean, "to" boolean)
 *   where a.id = '<audit id>' and j.id = c.id and j.is_it = c."to";
 * Note a later hiring sync re-derives is_it from the title with the classifier
 * of the day, so revert the classifier change too if the revert must stick.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-role-classifier-development.ts [--title-regex=<regex>]
 *   npx tsx --env-file=.env.local scripts/backfill-role-classifier-development.ts --execute --actor=<bd id>
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog } from "../src/db/schema";
import { planRoleGroupPage, summarizeTally, type RoleGroupChange, type RoleGroupTally } from "../src/lib/contacts/personRoleGroupBackfill";
import { planPostingIsItPage, type PostingIsItChange } from "../src/lib/hiring/postingIsItBackfill";

const BATCH_SIZE = 1000;
const MAX_CHANGES = 5000;
const AUDIT_ACTION = "backfill_role_classifier_development";

type Executor = Pick<typeof db, "execute">;
type PersonChange = Pick<RoleGroupChange, "id" | "from" | "roleGroup">;

function parseArgs(argv: string[]) {
  let execute = false;
  let actor: string | null = null;
  let titleRegex: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--title-regex=")) titleRegex = arg.slice("--title-regex=".length) || null;
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --actor=<bd id>, --title-regex=<postgres regex>`);
  }
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");
  return { execute, actor, titleRegex };
}

async function scanPersons(ex: Executor, titleRegex: string | null) {
  const tally: RoleGroupTally = { before: {}, after: {}, transitions: {}, skippedHumanEdits: 0 };
  const changes: PersonChange[] = [];
  let lastId: string | null = null;
  for (;;) {
    const rows: { id: string; job_title: string | null; role_group: string | null; human_edited: boolean }[] = await ex.execute(sql`
      select id::text as id, job_title, role_group,
        exists (select 1 from person_property_history h where h.person_id = person.id and h.property = 'roleGroup' and h.source = 'edit') as human_edited
      from person
      where merged_into_id is null ${titleRegex === null ? sql`` : sql`and job_title ~* ${titleRegex}`}
        ${lastId === null ? sql`` : sql`and id > ${lastId}::uuid`}
      order by id
      limit ${BATCH_SIZE}
    `);
    if (rows.length === 0) break;
    const page = planRoleGroupPage(
      rows.map((r) => ({ id: r.id, jobTitle: r.job_title, roleGroup: r.role_group, humanEdited: r.human_edited === true })),
      tally,
    );
    for (const c of page) changes.push({ id: c.id, from: c.from, roleGroup: c.roleGroup });
    lastId = rows[rows.length - 1].id;
  }
  return { tally, changes };
}

async function scanPostings(ex: Executor, titleRegex: string | null) {
  const changes: PostingIsItChange[] = [];
  let scanned = 0;
  let lastId: string | null = null;
  for (;;) {
    const rows: { id: string; title: string; is_it: boolean }[] = await ex.execute(sql`
      select id::text as id, title, is_it
      from job_posting
      where true ${titleRegex === null ? sql`` : sql`and title ~* ${titleRegex}`}
        ${lastId === null ? sql`` : sql`and id > ${lastId}::uuid`}
      order by id
      limit ${BATCH_SIZE}
    `);
    if (rows.length === 0) break;
    changes.push(...planPostingIsItPage(rows.map((r) => ({ id: r.id, title: r.title, isIt: r.is_it === true }))));
    scanned += rows.length;
    lastId = rows[rows.length - 1].id;
  }
  return { scanned, changes };
}

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) out.push(items.slice(i, i + BATCH_SIZE));
  return out;
}

function printPersons(label: string, tally: RoleGroupTally) {
  const s = summarizeTally(tally);
  console.log(`\n--- person.role_group (${label}) ---`);
  console.log("Current distribution (in scope):");
  for (const r of s.before) console.log(`  ${String(r.count).padStart(6)}  ${r.group}`);
  console.log("Distribution after the change:");
  for (const r of s.after) console.log(`  ${String(r.count).padStart(6)}  ${r.group}`);
  console.log("Transitions:");
  if (s.transitions.length === 0) console.log("  (none)");
  for (const r of s.transitions) console.log(`  ${String(r.count).padStart(6)}  ${r.transition}`);
  console.log(`Skipped, human-edited role group: ${s.skippedHumanEdits}`);
  if (s.nullClassified > 0) console.log(`WARNING: ${s.nullClassified} NULL role_group row(s) get classified; a revert cannot restore NULL.`);
}

function printPostings(scanned: number, changes: PostingIsItChange[]) {
  const toIt = changes.filter((c) => c.to).length;
  console.log(`\n--- job_posting.is_it ---`);
  console.log(`In scope: ${scanned}. Changing: ${changes.length} (false -> true: ${toIt}, true -> false: ${changes.length - toIt})`);
}

async function main() {
  const { execute, actor, titleRegex } = parseArgs(process.argv.slice(2));
  const persons = await scanPersons(db, titleRegex);
  const postings = await scanPostings(db, titleRegex);
  const total = persons.changes.length + postings.changes.length;
  console.log(`=== ${execute ? "EXECUTE" : "DRY RUN"}: scope: ${titleRegex === null ? "all non-merged persons, all postings" : `titles ~* ${titleRegex}`} ===`);
  printPersons("planned", persons.tally);
  printPostings(postings.scanned, postings.changes);
  console.log(`\nTotal rows to change: ${total} (limit ${MAX_CHANGES})`);

  if (!execute) {
    console.log("Dry run: nothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  if (total > MAX_CHANGES) throw new Error(`Refusing to write ${total} rows (limit ${MAX_CHANGES}).`);
  if (total === 0) {
    console.log("Nothing to update.");
    return;
  }

  await db.transaction(async (tx) => {
    for (const batch of chunks(persons.changes)) {
      const tuples = sql.join(batch.map((c) => sql`(${c.id}::uuid, ${c.roleGroup}::text)`), sql`, `);
      await tx.execute(sql`
        update person p set role_group = v.role_group
        from (values ${tuples}) as v(id, role_group)
        where p.id = v.id and p.role_group is distinct from v.role_group
      `);
    }
    for (const batch of chunks(postings.changes)) {
      const tuples = sql.join(batch.map((c) => sql`(${c.id}::uuid, ${c.to}::boolean)`), sql`, `);
      await tx.execute(sql`
        update job_posting j set is_it = v.is_it
        from (values ${tuples}) as v(id, is_it)
        where j.id = v.id and j.is_it is distinct from v.is_it
      `);
    }

    // Read back what was written, still inside the transaction: any mismatch aborts everything.
    let personMismatch = 0;
    for (const batch of chunks(persons.changes)) {
      const tuples = sql.join(batch.map((c) => sql`(${c.id}::uuid, ${c.roleGroup}::text)`), sql`, `);
      const r: { n: number }[] = await tx.execute(sql`
        select count(*)::int as n from (values ${tuples}) as v(id, role_group)
        join person p on p.id = v.id where p.role_group is distinct from v.role_group
      `);
      personMismatch += Number(r[0]?.n ?? 0);
    }
    let postingMismatch = 0;
    for (const batch of chunks(postings.changes)) {
      const tuples = sql.join(batch.map((c) => sql`(${c.id}::uuid, ${c.to}::boolean)`), sql`, `);
      const r: { n: number }[] = await tx.execute(sql`
        select count(*)::int as n from (values ${tuples}) as v(id, is_it)
        join job_posting j on j.id = v.id where j.is_it is distinct from v.is_it
      `);
      postingMismatch += Number(r[0]?.n ?? 0);
    }
    if (personMismatch > 0 || postingMismatch > 0) {
      throw new Error(`Read-back mismatch (persons ${personMismatch}, postings ${postingMismatch}); rolled back.`);
    }

    await tx.insert(auditLog).values({
      actorBdId: actor!,
      action: AUDIT_ACTION,
      metadata: {
        filter: { titleRegex },
        persons: {
          updated: persons.changes.length,
          skippedHumanEdits: persons.tally.skippedHumanEdits,
          transitions: summarizeTally(persons.tally).transitions,
          changes: persons.changes.map((c) => ({ id: c.id, from: c.from, to: c.roleGroup })),
        },
        postings: {
          updated: postings.changes.length,
          changes: postings.changes,
        },
      },
    });
  });

  // Fresh read after commit: the real stored state, using the same scan as the dry run.
  const after = await scanPersons(db, titleRegex);
  const afterPostings = await scanPostings(db, titleRegex);
  console.log(`\nEXECUTED. Wrote ${persons.changes.length} person(s), ${postings.changes.length} posting(s), 1 audit_log row.`);
  console.log(`Read-back (committed): person rows still differing from the classifier: ${after.changes.length}; postings: ${afterPostings.changes.length} (both should be 0, or human-edited persons only).`);
  printPersons("committed state", { ...after.tally, transitions: {} });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
