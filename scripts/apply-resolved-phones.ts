/**
 * Owner-run application of the phone numbers a human resolved by hand.
 *
 * WHY THIS EXISTS: scripts/extract-signature-phones.ts deliberately writes
 * nothing when one person's email signatures yield two or more different
 * numbers. Contradictory evidence is not a number to guess at, so it counts
 * those people and leaves them alone — twelve of them on the last run, one of
 * which turned out to be a calendar-notification sender carrying three numbers
 * that belong to nobody. This script applies the answers a person gave after
 * looking at the candidates.
 *
 * INPUT: --json=<path>, an array of {"personId","number","kind"}. JSON rather
 * than a delimited line format on purpose: a phone number or an id can contain
 * almost anything, and scripts/merge-companies.ts already hit exactly that wall
 * with a company key holding a colon.
 *
 *   kind: "mobile"   -> mobile_phone
 *         "landline" -> phone
 *         "generic"  -> phone   (the signature's label did not say which)
 *
 * The kind comes from the LABEL the signature carried, never from the digits:
 * detecting an Argentine mobile by prefix is wrong often enough to poison the
 * column, and that ban is the same one the extractor follows.
 *
 * REFUSES THE WHOLE RUN, writing nothing, on any disagreement: a person id that
 * matches no live person, a number src/lib/phone.ts rejects, two entries aiming
 * at the same column, or a target column that already holds a number. That last
 * one is a refusal and not a skip because this input is a human decision — if
 * it collides with the database, the two disagree and somebody should look.
 *
 * FILL-EMPTY ONLY, re-guarded in SQL at write time, so a number entered between
 * the dry run and the write is never overwritten.
 *
 * ONE transaction. One person_property_history row per number, source
 * 'signature_extract' — the same provenance the extractor uses, because this is
 * a human finishing the job it left open, not a different source of truth. ONE
 * audit_log row (action 'apply_resolved_phones').
 *
 * REVERT: for each entry in the audit row's metadata, set that column back to
 * NULL where it still equals the value in the matching person_property_history
 * row (source 'signature_extract', at >= the audit row's time), then delete
 * those history rows.
 *
 * EXIT CODES: 0 success (dry run or write); 1 bad arguments or any refusal
 * (nothing written).
 *
 * Usage (do NOT run --execute automatically: this touches the real database):
 *   npx tsx --env-file=.env.local scripts/apply-resolved-phones.ts --json=<path>
 *   npx tsx --env-file=.env.local scripts/apply-resolved-phones.ts --json=<path> --execute --actor=<bd id>
 */
import { readFileSync } from "node:fs";
import { dryRunResolvedPhones, executeResolvedPhones } from "../src/lib/resolvedPhones/db";
import { parseResolvedPhonesJson, type ResolvedPhoneWrite } from "../src/lib/resolvedPhones/plan";

function parseArgs(argv: readonly string[]) {
  let json: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--json=")) {
      if (json) throw new Error("--json passed twice.");
      json = arg.slice("--json=".length);
    } else throw new Error(`Unknown argument: ${arg}. Valid: --json=<path>, --execute, --actor=<bd id>`);
  }
  if (!json) throw new Error("Usage: apply-resolved-phones.ts --json=<path> [--execute --actor=<bd id>]");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { json, execute, actor };
}

/** Counts and columns only: the numbers themselves are PII. */
function report(writes: readonly ResolvedPhoneWrite[]): string {
  const byColumn = writes.reduce<Record<string, number>>((acc, w) => ({ ...acc, [w.column]: (acc[w.column] ?? 0) + 1 }), {});
  return [
    `Numbers to apply: ${writes.length}`,
    `  into mobile_phone: ${byColumn.mobilePhone ?? 0}`,
    `  into phone:        ${byColumn.phone ?? 0}`,
  ].join("\n");
}

async function main() {
  const { json, execute, actor } = parseArgs(process.argv.slice(2));
  const inputs = parseResolvedPhonesJson(readFileSync(json, "utf-8"));

  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    console.log(report(await dryRunResolvedPhones(inputs)));
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const { writes, auditLogId } = await executeResolvedPhones(inputs, actor!);
  console.log(report(writes));
  console.log(`\nApplied ${writes.length} number(s). audit_log id: ${auditLogId}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
