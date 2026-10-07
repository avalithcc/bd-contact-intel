/**
 * Owner-run backfill of the fi-arg-2026 fields the lead -> person fold dropped:
 * person.company (display text), city, country and seniority. Measured on
 * person: 0 of 1,053 carried any of them.
 *
 * INPUT: the `lead` table itself. No files, no arguments beyond --execute and
 * --actor. scripts/import-leads.ts already wrote these values onto `lead`
 * (measured for fi-arg-2026: city 1057/1057, country 1057/1057, company_raw
 * 1057/1057, seniority 994/1057), so everything this needs is already in the
 * database. Reading the attendee CSVs instead would tie the script to
 * ../lead_gen/data, a directory outside this repo: the day it moves, the script
 * dies and the reason is not obvious. The report prints COUNTS ONLY.
 *
 * DRY RUN IS THE DEFAULT, inside a READ ONLY transaction. Nothing is written
 * unless --execute is passed, and --execute also needs --actor=<bd id>.
 *
 * IDENTITY (same as scripts/import-leads.ts): an attendee_id is matched to its
 * person by lead(source_key 'fi-arg-2026', attendee_id) -> person_id_map
 * ('lead', lead.id) -> person. No name or email matching, nothing is guessed.
 * An attendee with no person, and a person that is merged away or whose
 * source_key is not 'fi-arg-2026', are counted and left alone. `lead` holds
 * more rows than there are persons (leadRowsToIdentityRows drops leads with no
 * owner), and that difference shows up as the unmatched count.
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
 * EXIT CODES: 0 success (dry run or write); 1 bad arguments or any failed check
 * (nothing written).
 *
 * Usage (do NOT run --execute automatically: this touches the real database):
 *   npx tsx --env-file=.env.local scripts/backfill-fi-arg-fields.ts
 *   npx tsx --env-file=.env.local scripts/backfill-fi-arg-fields.ts --execute --actor=<bd id>
 */
import { dryRunFiArg, executeFiArg } from "../src/lib/fiArgBackfill/db";
import { FILL_FIELDS, type FiArgReport } from "../src/lib/fiArgBackfill/plan";

function parseArgs(argv: readonly string[]) {
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --actor=<bd id>`);
  }
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { execute, actor };
}

function report(r: FiArgReport): string {
  return [
    `Source lead rows (fi-arg-2026): ${r.leads}`,
    `Matched to an in-scope person: ${r.matched}`,
    `Lead with no person (counted, not guessed): ${r.unmatched}`,
    `Person merged away or other source_key (kept): ${r.outOfScope}`,
    `Persons with at least one fill: ${r.personsFilled}`,
    ...FILL_FIELDS.map((f) => `    ${f}: ${r.filled[f]}`),
  ].join("\n");
}

async function main() {
  const { execute, actor } = parseArgs(process.argv.slice(2));

  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    console.log(report((await dryRunFiArg()).report));
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  const { fills, report: r, auditLogId } = await executeFiArg(actor!);
  console.log(report(r));
  console.log(auditLogId ? `\nFilled ${fills.length} field(s) on ${r.personsFilled} person(s). audit_log id: ${auditLogId}` : "\nNothing to fill.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
