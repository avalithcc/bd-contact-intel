/**
 * Owner-run import of the "para llamar hoteles" sheet (149 rows, hotel
 * contacts), every person and company assigned to Mariel Meza. Parsing,
 * planning and the report live in src/lib/hoteles2026/{rows,plan,report}.ts
 * (unit-tested); db.ts does the writes.
 *
 * The CSV is read from the path you pass and is NEVER copied into the repo
 * (same convention as scripts/import-leads.ts). It holds personal data.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written unless --execute is passed, and
 * --execute also needs --actor=<bd id> (recorded in audit_log). The dry run
 * runs inside a READ ONLY transaction and prints counts and row numbers only.
 *
 * MAPPING (CSV column -> column)
 *   First/Last name -> person.first_name/last_name   Job title -> job_title,
 *   role_group = classifyPosition(job title) (src/lib/roleGroups.ts)
 *   Professional email -> email, email_normalized (lowercased); email_status
 *     'probable', email_source = source key; none -> status 'none'
 *   Phone number -> person.phone       Mobile phone -> person.mobile_phone
 *   LinkedIn profile URL -> person.profile_key (normalizeProfileKey)
 *   Company name -> person.company + company.display_name; company_key =
 *     normalizeCompanyKey via company_alias (resolveHotelCompanyKey)
 *   Country -> person.country and company.country (new companies)
 *   TYPE OF CONTACT -> person.contact_type (BUYER-CHAMPION | INFLUENCER)
 *   Every person: source_key 'hoteles-2026-10', owner_bd_id Mariel, status 'new'.
 *   New companies: relationship_stage 'prospect', owner_bd_id Mariel.
 *   An existing company with NO owner gets Mariel; one owned by another BD is
 *   left alone and reported.
 *   NOT imported: Campaigns (history of a different outreach tool), Website,
 *   Industry, Number of employees, Company LinkedIn URL, Contact country.
 *   person_bd_connection is NOT written (it is a messaging signal, not an
 *   assignment table).
 *
 * IDEMPOTENCY / EMAIL-LESS ROWS: see the header of src/lib/hoteles2026/plan.ts.
 * Keys: email, else LinkedIn profile key, else name+company. A re-run finds
 * its own people and creates nothing. Email-less rows are the fragile ones.
 *
 * REVERT (all of it is one audit_log row, action 'hoteles_2026_10_import';
 * its metadata holds createdPersonIds, companiesCreated, companyOwnerUpdates).
 * Only safe while nobody has acted on these people (activities/tasks cascade):
 *   DELETE FROM person WHERE source_key = 'hoteles-2026-10';
 *   DELETE FROM company WHERE company_key IN (<companiesCreated>)
 *     AND NOT EXISTS (SELECT 1 FROM person p WHERE p.company_key = company.company_key);
 *   UPDATE company SET owner_bd_id = NULL WHERE company_key IN (<companyOwnerUpdates>);
 * Run them in one transaction.
 *
 * Usage (do NOT run automatically: this touches the real database):
 *   npx tsx --env-file=.env.local scripts/import-hoteles-2026-10.ts <csv>                       # dry run
 *   npx tsx --env-file=.env.local scripts/import-hoteles-2026-10.ts <csv> --execute --actor=<bd id>
 */
import { readFileSync } from "node:fs";
import { dryRunHotelImport, executeHotelImport } from "../src/lib/hoteles2026/db";
import { formatHotelReport } from "../src/lib/hoteles2026/report";
import { parseHotelRows } from "../src/lib/hoteles2026/rows";

function parseArgs(argv: readonly string[]) {
  let csvPath: string | null = null;
  let execute = false;
  let dryRun = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (!arg.startsWith("--") && !csvPath) csvPath = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!csvPath) throw new Error("Usage: import-hoteles-2026-10.ts <csv path> [--dry-run | --execute --actor=<bd id>]");
  if (execute && dryRun) throw new Error("--execute and --dry-run are mutually exclusive.");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { csvPath, execute, actor };
}

async function main() {
  const { csvPath, execute, actor } = parseArgs(process.argv.slice(2));
  const parsed = parseHotelRows(readFileSync(csvPath, "utf-8"));

  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    console.log(formatHotelReport(await dryRunHotelImport(parsed)).join("\n"));
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  const { plan, auditLogId } = await executeHotelImport(parsed, actor!);
  console.log(formatHotelReport(plan).join("\n"));
  console.log(auditLogId ? `\nWrote ${plan.creates.length} person(s). audit_log id: ${auditLogId}` : "\nNothing to write (already imported).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
