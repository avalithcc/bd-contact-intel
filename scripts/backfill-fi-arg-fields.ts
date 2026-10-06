/**
 * Owner-run backfill of the fi-arg-2026 fields the lead -> person fold dropped:
 * person.company (display text), city, country and seniority. They exist in the
 * lead_gen CSVs and never landed on person (measured: 0 of 1,053).
 *
 * INPUT: the lead_gen data directory (a sibling of this repo, never copied in):
 *   --dir=<path to lead_gen/data>   reads fi-arg-2026-attendees.csv and
 *   fi-arg-2026-decisores-bancos-fintech.csv. The rows hold personal data; the
 *   report prints COUNTS ONLY.
 *
 * DRY RUN IS THE DEFAULT, inside a READ ONLY transaction. Nothing is written
 * unless --execute is passed, and --execute also needs --actor=<bd id>.
 *
 * IDENTITY (same as scripts/import-leads.ts): the CSVs go through the same
 * buildLeadDrafts() merge the import used; an attendee_id is matched to its
 * person by lead(source_key 'fi-arg-2026', attendee_id) -> person_id_map
 * ('lead', lead.id) -> person. No name or email matching, nothing is guessed.
 * An attendee with no person, and a person that is merged away or whose
 * source_key is not 'fi-arg-2026', are counted and left alone.
 *
 * FILL-EMPTY ONLY: a field is written only where it is NULL or blank, and the
 * UPDATE re-checks that in SQL, so a value a BD set since the read is never
 * overwritten (a conflict aborts the whole run). company is the cleaned display
 * name when the decisores file has one, else the raw name, as the import did.
 * One person_property_history row per filled field, source 'import'.
 *
 * ONE transaction, ONE audit_log row (action 'backfill_fi_arg_fields') listing
 * the filled person ids per field.
 * REVERT: for each field, set the column to NULL where it still equals the
 * person_property_history.new_value written by this run (source 'import',
 * at >= the audit row's time, property in company/city/country/seniority), then
 * delete those history rows.
 *
 * EXIT CODES: 0 success (dry run or write); 1 bad arguments, a missing file, or
 * any failed check (nothing written).
 *
 * Usage (do NOT run --execute automatically: this touches the real database):
 *   npx tsx --env-file=.env.local scripts/backfill-fi-arg-fields.ts --dir=<lead_gen/data>
 *   npx tsx --env-file=.env.local scripts/backfill-fi-arg-fields.ts --dir=<lead_gen/data> --execute --actor=<bd id>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dryRunFiArg, executeFiArg } from "../src/lib/fiArgBackfill/db";
import { FILL_FIELDS, type FiArgReport } from "../src/lib/fiArgBackfill/plan";
import { buildLeadDrafts } from "../src/lib/leads/csv";

function parseArgs(argv: readonly string[]) {
  let dir: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--dir=")) dir = arg.slice("--dir=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --dir=<path>, --execute, --actor=<bd id>`);
  }
  if (!dir) throw new Error("Usage: backfill-fi-arg-fields.ts --dir=<lead_gen/data> [--execute --actor=<bd id>]");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { dir, execute, actor };
}

function report(r: FiArgReport): string {
  return [
    `Source attendees (merged like the import): ${r.sourceRows}`,
    `Matched to an in-scope person: ${r.matched}`,
    `No person found (kept, not guessed): ${r.unmatched}`,
    `Person merged away or other source_key (kept): ${r.outOfScope}`,
    `Persons with at least one fill: ${r.personsFilled}`,
    ...FILL_FIELDS.map((f) => `    ${f}: ${r.filled[f]}`),
  ].join("\n");
}

async function main() {
  const { dir, execute, actor } = parseArgs(process.argv.slice(2));
  const drafts = buildLeadDrafts({
    attendees: readFileSync(join(dir, "fi-arg-2026-attendees.csv"), "utf-8"),
    decisores: readFileSync(join(dir, "fi-arg-2026-decisores-bancos-fintech.csv"), "utf-8"),
  });
  if (!drafts.length) throw new Error("No attendees found in the CSVs.");

  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    console.log(report((await dryRunFiArg(drafts)).report));
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  const { fills, report: r, auditLogId } = await executeFiArg(drafts, actor!);
  console.log(report(r));
  console.log(auditLogId ? `\nFilled ${fills.length} field(s) on ${r.personsFilled} person(s). audit_log id: ${auditLogId}` : "\nNothing to fill.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
