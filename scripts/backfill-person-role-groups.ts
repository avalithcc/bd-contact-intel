/**
 * Recompute `person.role_group` from `person.job_title` with the current
 * classifyPosition (src/lib/roleGroups.ts). `person.role_group` is the column
 * the contacts list, the role-visibility rule, hiring and outreach read; the
 * importers set it once at insert time and nothing refreshed it afterwards.
 * (scripts/backfill-role-groups.ts only touches the legacy `contact` table.)
 *
 * Scope: persons that were not merged away (`merged_into_id IS NULL`), the
 * only ones any read shows. `--source-key=<key>` narrows the whole run, dry or
 * execute, to persons with that `source_key`.
 *
 * Defaults to a DRY RUN that only reads and prints, for the selected scope:
 * the current distribution, the distribution after the change, and every
 * `from -> to` transition with its count.
 *
 * `--execute --actor=<bd id>`: pages through the scope by keyset on `id`
 * (batches of BATCH_SIZE, never the whole table in memory) and, inside ONE
 * transaction, updates only rows whose computed group differs from the stored
 * one with a bulk UPDATE ... FROM (VALUES ...) per batch, plus ONE `audit_log`
 * row (action `backfill_person_role_groups`). The audit metadata holds the
 * filter and the transition counts only, deliberately NOT the ~27k row ids:
 * counts and the filter are what matters. `person.updated_at` is left alone
 * because role_group is a derived cache.
 *
 * Idempotent: a second run finds no differing row and reports zero
 * transitions (and writes nothing, no audit row).
 *
 * Revert: the audit row is not row-exact by design. To undo, `git revert` the
 * classifier change and re-run this script with the same filter; the old rules
 * recompute the old groups. Persons whose stored group was NULL come back as
 * `no_position`/`other` rather than NULL (the classifier never yields NULL).
 *
 * Usage (dry run is the default):
 *   npx tsx --env-file=.env.local scripts/backfill-person-role-groups.ts [--source-key=<key>]
 *   npx tsx --env-file=.env.local scripts/backfill-person-role-groups.ts --execute --actor=<bd id> [--source-key=<key>]
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog } from "../src/db/schema";
import {
  planRoleGroupPage,
  summarizeTally,
  type PersonRoleGroupRow,
  type RoleGroupTally,
} from "../src/lib/contacts/personRoleGroupBackfill";

const BATCH_SIZE = 1000;
const AUDIT_ACTION = "backfill_person_role_groups";

function parseArgs(argv: string[]) {
  let execute = false;
  let actor: string | null = null;
  let sourceKey: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--source-key=")) sourceKey = arg.slice("--source-key=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --actor=<bd id>, --source-key=<key>`);
  }
  if (sourceKey !== null && sourceKey === "") throw new Error("--source-key must not be empty");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");
  return { execute, actor, sourceKey };
}

type Executor = Pick<typeof db, "execute">;

async function fetchPage(ex: Executor, lastId: string | null, sourceKey: string | null): Promise<PersonRoleGroupRow[]> {
  const conditions: SQL[] = [sql`merged_into_id is null`];
  if (lastId !== null) conditions.push(sql`id > ${lastId}::uuid`);
  if (sourceKey !== null) conditions.push(sql`source_key = ${sourceKey}`);
  const rows = await ex.execute<{ id: string; job_title: string | null; role_group: string | null }>(sql`
    select id::text as id, job_title, role_group
    from person
    where ${sql.join(conditions, sql` and `)}
    order by id
    limit ${BATCH_SIZE}
  `);
  return rows.map((r) => ({ id: r.id, jobTitle: r.job_title, roleGroup: r.role_group }));
}

/** Walks the whole scope; `onChanges` receives the rows to update per page. */
async function scan(
  ex: Executor,
  sourceKey: string | null,
  onChanges: (changes: { id: string; roleGroup: string }[]) => Promise<void>,
): Promise<{ tally: RoleGroupTally; total: number; changed: number }> {
  const tally: RoleGroupTally = { before: {}, after: {}, transitions: {} };
  let lastId: string | null = null;
  let total = 0;
  let changed = 0;
  for (;;) {
    const page = await fetchPage(ex, lastId, sourceKey);
    if (page.length === 0) break;
    const changes = planRoleGroupPage(page, tally);
    if (changes.length > 0) await onChanges(changes);
    total += page.length;
    changed += changes.length;
    lastId = page[page.length - 1].id;
  }
  return { tally, total, changed };
}

function print(label: string, scope: string, result: { tally: RoleGroupTally; total: number; changed: number }) {
  const s = summarizeTally(result.tally);
  console.log(`\n=== ${label} (${scope}): ${result.total} persons, ${result.changed} would change ===`);
  console.log("Current distribution:");
  for (const r of s.before) console.log(`  ${String(r.count).padStart(6)}  ${r.group}`);
  console.log("Distribution after the change:");
  for (const r of s.after) console.log(`  ${String(r.count).padStart(6)}  ${r.group}`);
  console.log("Transitions:");
  if (s.transitions.length === 0) console.log("  (none)");
  for (const r of s.transitions) console.log(`  ${String(r.count).padStart(6)}  ${r.transition}`);
}

async function main() {
  const { execute, actor, sourceKey } = parseArgs(process.argv.slice(2));
  const scope = sourceKey === null ? "all non-merged persons" : `source_key=${sourceKey}`;

  if (!execute) {
    const result = await scan(db, sourceKey, async () => {});
    print("DRY RUN", scope, result);
    console.log("\nDry run: nothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const result = await db.transaction(async (tx) => {
    const r = await scan(tx, sourceKey, async (changes) => {
      const tuples = sql.join(changes.map((c) => sql`(${c.id}::uuid, ${c.roleGroup}::text)`), sql`, `);
      await tx.execute(sql`
        update person p
        set role_group = v.role_group
        from (values ${tuples}) as v(id, role_group)
        where p.id = v.id and p.role_group is distinct from v.role_group
      `);
    });
    if (r.changed > 0) {
      await tx.insert(auditLog).values({
        actorBdId: actor!,
        action: AUDIT_ACTION,
        metadata: { filter: { sourceKey }, scanned: r.total, updated: r.changed, transitions: summarizeTally(r.tally).transitions },
      });
    }
    return r;
  });
  print("EXECUTED", scope, result);
  console.log(result.changed > 0 ? `\nUpdated ${result.changed} person(s) and wrote 1 audit_log row.` : "\nNothing to update.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
