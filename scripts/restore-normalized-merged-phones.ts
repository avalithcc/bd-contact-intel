/**
 * Restores the merged-phone survivor(s) the first restore skipped: a stranded
 * phone on a merged-away row that failed `isValidPhoneFormat` (dot-separated
 * `+54.9.11...`). The E.164 backfill never touched it either (it processes
 * live rows only). The value is normalized with `normalizePhone`
 * (src/lib/phoneNormalize.ts, never guessing a country) and written to the
 * survivor, only where the survivor has no phone and no mobile.
 *
 * Same write path as scripts/restore-merged-phones.ts (executeRestore): ONE
 * transaction, history rows with the actor, ONE audit_log row
 * (`restore_merged_phones_run`, with the exact fills) and the same revert:
 *   npx tsx --env-file=.env.local scripts/restore-merged-phones.ts --revert=<runId> --actor=<bd id>
 *
 * Dry run is the default and prints counts and person ids only (no numbers).
 *   npx tsx --env-file=.env.local scripts/restore-normalized-merged-phones.ts
 *   npx tsx --env-file=.env.local scripts/restore-normalized-merged-phones.ts --execute --actor=<bd id>
 */
import { randomUUID } from "node:crypto";
import { planNormalizedMergedPhones } from "../src/lib/identity/restoreNormalizedMergedPhones";
import { assertActorExists, executeRestore, readPhoneRestoreRows } from "../src/lib/identity/restoreMergedPhonesDb";

function parseArgs(argv: readonly string[]) {
  let execute = false;
  let actor: string | undefined;
  for (const raw of argv) {
    if (raw === "--execute") execute = true;
    else if (raw.startsWith("--actor=")) actor = raw.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${raw}. Valid: --execute, --actor=<bd id>`);
  }
  return { execute, actor };
}

async function main(): Promise<void> {
  const { execute, actor } = parseArgs(process.argv.slice(2));
  const { rows } = await readPhoneRestoreRows();
  const { plan, normalized, unresolved } = planNormalizedMergedPhones(rows);

  console.log(`Merged-away rows read: ${plan.counts.mergedRows}`);
  console.log(`Stranded values normalized to E.164: ${normalized.length}`);
  const byReason: Record<string, number> = {};
  for (const u of unresolved) byReason[u.reason] = (byReason[u.reason] ?? 0) + 1;
  console.log(`Stranded invalid values still unresolved (left as is): ${unresolved.length} ${JSON.stringify(byReason)}`);
  console.log(`Survivors that would be restored: ${plan.restorable.length}`);
  for (const s of plan.restorable) console.log(`  survivor ${s.survivorId}: ${s.fills.map((f) => f.field).join(", ")}`);
  console.log(`Skipped for a human (merged rows disagree): ${plan.conflicts.length}`);

  if (!execute) {
    console.log("\nDry run only (default) - pass --execute --actor=<bd id> to write.");
    return;
  }
  if (!actor) throw new Error("Refusing to execute: pass --actor=<bd id>.");
  await assertActorExists(actor);
  const runId = randomUUID();
  const written = await executeRestore(plan, actor, runId);
  console.log(`\nRun ${runId}: wrote ${written} fill(s).`);
  if (written > 0) console.log(`To revert: npx tsx --env-file=.env.local scripts/restore-merged-phones.ts --revert=${runId} --actor=<bd id>`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
