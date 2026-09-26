/**
 * Recomputes the derived status (design R4) of every live person.
 *
 * Status is recomputed on each write since the status derivation shipped, but
 * persons created by the migrations were never derived: they all sit at the
 * default. Run this once when releasing the derived-status reads.
 *
 * Uses the same recomputePersonStatuses the write paths use, inside one
 * transaction. The DRY RUN (default) executes it and rolls back, printing the
 * status distribution it would produce. --apply --actor=<bd id> commits and
 * writes one audit_log row. Re-running is harmless (same inputs, same result).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/recompute-person-statuses.ts
 *   npx tsx --env-file=.env.local scripts/recompute-person-statuses.ts --apply --actor=<bd id>
 */
import { isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, person } from "../src/db/schema";
import { recomputePersonStatuses } from "../src/lib/status/recompute";

class DryRunRollback extends Error {}

function parseArgs(argv: string[]): { apply: boolean; actor: string | null } {
  let apply = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --apply, --actor=<bd id>`);
  }
  if (apply && !actor) throw new Error("--apply requires --actor=<bd id> for the audit log");
  return { apply, actor };
}

async function main() {
  const { apply, actor } = parseArgs(process.argv.slice(2));
  const before = (await db.execute(
    sql`select status, count(*)::int as n from person where merged_into_id is null group by status order by n desc`,
  )) as unknown as { status: string; n: number }[];
  console.log("Before:", JSON.stringify(before));

  let after: { status: string; n: number }[] = [];
  try {
    await db.transaction(async (tx) => {
      const ids = await tx.select({ id: person.id }).from(person).where(isNull(person.mergedIntoId));
      await recomputePersonStatuses(tx, ids.map((r) => r.id));
      after = (await tx.execute(
        sql`select status, count(*)::int as n from person where merged_into_id is null group by status order by n desc`,
      )) as unknown as { status: string; n: number }[];
      if (!apply) throw new DryRunRollback();
      await tx.insert(auditLog).values({
        actorBdId: actor!,
        action: "migration_recompute_status",
        metadata: { persons: ids.length, distribution: after },
      });
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }

  console.log(apply ? "After (committed):" : "After (dry run, rolled back):", JSON.stringify(after));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
