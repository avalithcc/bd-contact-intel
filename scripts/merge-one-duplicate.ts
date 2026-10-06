/**
 * Owner-run merge of ONE open duplicate_candidate, for a pair the bulk script
 * cannot reach: scripts/merge-duplicates.ts works by tier and leaves a pair in
 * `review` untouched. This reuses mergeContacts (src/lib/identity/mergeDb.ts),
 * the exact function /admin/duplicates calls; there is no second merge.
 *
 * SURVIVOR: derived the way the UI derives it (chooseDefaultSurvivor: a LinkedIn
 * profile key first, then the earliest connection, then the earlier created_at,
 * else side A). The report says which person it picked and why. --survivor=<id>
 * is only an assertion: if it disagrees with that default the script REFUSES
 * (it never overrides the rule and never guesses). It also refuses when the
 * survivor would lose synced Gmail messages or a profile key (the guard the bulk
 * script uses), when the candidate is not open, or when a person is already
 * merged away. Activities, tasks, notes and the owner move to the survivor
 * under planMerge's rules, like in the UI.
 *
 * ONE mergeContacts transaction: it locks both rows, writes the merge_event
 * snapshot, marks the candidate merged and writes ONE audit_log row (action
 * 'merge', metadata.mergeEventId). REVERT: "Deshacer fusion" in /admin/duplicates
 * for that merge event (unmergeContact), which restores both people from the
 * snapshot.
 *
 * DRY RUN IS THE DEFAULT (read-only transaction). Output is ids, flags and
 * counts: no names, emails or phones. Usage (do NOT run --execute without the
 * owner's approval):
 *   npx tsx --env-file=.env.local scripts/merge-one-duplicate.ts --candidate=<id> [--survivor=<person id>]
 *   npx tsx --env-file=.env.local scripts/merge-one-duplicate.ts --candidate=<id> [--survivor=<person id>] --execute --actor=<bd id>
 *
 * EXIT CODES: 0 success (dry run or merge); 1 bad arguments or a refusal
 * (nothing written).
 */
import { dryRunMergeOne, executeMergeOne, type MergeOneReport } from "../src/lib/identity/mergeOneDuplicateDb";

function parseArgs(argv: readonly string[]) {
  let candidate: string | null = null;
  let survivor: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--candidate=")) candidate = arg.slice("--candidate=".length);
    else if (arg.startsWith("--survivor=")) survivor = arg.slice("--survivor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --candidate=<id>, --survivor=<person id>, --execute, --actor=<bd id>`);
  }
  if (!candidate) throw new Error("Usage: merge-one-duplicate.ts --candidate=<id> [--survivor=<person id>] [--execute --actor=<bd id>]");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { candidate, survivor, execute, actor };
}

function report({ plan, activities }: MergeOneReport): string {
  if (plan.kind === "refuse") return `REFUSED: ${plan.reason}`;
  return [
    `Candidate reason: ${plan.reason}`,
    `Survivor: ${plan.survivorId} (${activities[plan.survivorId] ?? 0} activities), picked by: ${plan.why}`,
    `Merged away: ${plan.mergedId} (${activities[plan.mergedId] ?? 0} activities)`,
  ].join("\n");
}

async function main() {
  const { candidate, survivor, execute, actor } = parseArgs(process.argv.slice(2));
  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    const r = await dryRunMergeOne(candidate, survivor);
    console.log(report(r));
    if (r.plan.kind === "refuse") process.exitCode = 1;
    else console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  const r = await executeMergeOne(candidate, survivor, actor!);
  console.log(report(r));
  if (r.plan.kind === "refuse") process.exitCode = 1;
  else console.log(`\nMerged. merge_event id: ${r.mergeEventId} (undo it from /admin/duplicates).`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
