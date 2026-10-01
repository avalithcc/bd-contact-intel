/**
 * Recovers phone numbers that merges dropped (fix/merge-carries-phone): a
 * merge never copied person.phone / person.mobile_phone, so the number stayed
 * on the merged-away row. For each survivor whose phone AND mobile_phone are
 * both blank, this fills them from the row(s) merged into it.
 *
 * - Only ever fills a blank; never overwrites.
 * - Merged rows that disagree on a number are NOT resolved: that survivor is
 *   skipped and reported for a human.
 * - A stranded value failing src/lib/phone.ts validation is reported, never
 *   written.
 * - Execute = ONE transaction, history rows with the actor, ONE audit_log
 *   row (action restore_merged_phones_run) holding the exact fills.
 *
 * The dry-run report lists every contact with its phone numbers (PII) so the
 * owner can check each line; do not paste it outside the team.
 *
 * Usage (dry run is the default; nothing is written):
 *   npx tsx --env-file=.env.local scripts/restore-merged-phones.ts
 * Execute (after the owner approves the dry run):
 *   npx tsx --env-file=.env.local scripts/restore-merged-phones.ts --execute --actor=<bd id>
 * Revert a run (clears only columns still holding the value the run wrote):
 *   npx tsx --env-file=.env.local scripts/restore-merged-phones.ts --revert=<runId> --actor=<bd id>
 */
import { randomUUID } from "node:crypto";
import { formatRestoreReport, planRestoreMergedPhones } from "../src/lib/identity/restoreMergedPhones";
import { assertActorExists, executeRestore, readPhoneRestoreRows, revertRestore } from "../src/lib/identity/restoreMergedPhonesDb";

interface CliArgs {
  execute: boolean;
  actor?: string;
  revert?: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { execute: false };
  for (const raw of argv) {
    if (raw === "--execute") args.execute = true;
    else if (raw.startsWith("--actor=")) args.actor = raw.slice("--actor=".length);
    else if (raw.startsWith("--revert=")) args.revert = raw.slice("--revert=".length);
    else throw new Error(`Unknown argument: ${raw}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.revert) {
    if (!args.actor) throw new Error("Refusing to revert: pass --actor=<bd id>.");
    await assertActorExists(args.actor);
    const { reverted, keptBecauseChanged } = await revertRestore(args.revert, args.actor);
    console.log(`Reverted ${reverted} fill(s); kept ${keptBecauseChanged} that changed since the run.`);
    return;
  }

  const { rows, ownerNameById } = await readPhoneRestoreRows();
  const plan = planRestoreMergedPhones(rows);
  for (const line of formatRestoreReport(plan, ownerNameById)) console.log(line);

  if (!args.execute) {
    console.log("\nDry run only (default) - pass --execute --actor=<bd id> to write.");
    return;
  }
  if (!args.actor) throw new Error("Refusing to execute: pass --actor=<bd id>.");
  await assertActorExists(args.actor);
  const runId = randomUUID();
  const written = await executeRestore(plan, args.actor, runId);
  console.log(`\nRun ${runId}: wrote ${written} fill(s).`);
  if (written > 0) console.log(`To revert: npx tsx --env-file=.env.local scripts/restore-merged-phones.ts --revert=${runId} --actor=<bd id>`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
