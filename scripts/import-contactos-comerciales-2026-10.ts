/**
 * Owner-run import of the commercial-contacts list the CEO emailed (PDF, 107
 * contacts), so the CRM matches reality and Mariel Meza can CALL them.
 * Parsing, planning and the report live in src/lib/contactosComerciales/
 * {parse,plan,report}.ts (unit-tested); db.ts does the writes.
 *
 * INPUT: the text of the PDF, never the PDF itself (no parsing dependency):
 *   pdftotext -layout "backups/contactos-comerciales 1.pdf" backups/contactos.txt
 * The PDF and the text hold personal data and are NEVER copied into the repo
 * (backups/ is gitignored); the report prints counts only.
 *
 * DRY RUN IS THE DEFAULT, inside a READ ONLY transaction. Nothing is written
 * unless --execute is passed, and --execute also needs --actor=<bd id>.
 *
 * WHAT IT DOES (matched by lowercased email against person.email_normalized,
 * merged rows excluded; the company column is only a guess and names may be
 * inferred, so neither is a key):
 *   - NEW contact: created with owner_bd_id = Mariel Meza and source_key
 *     'contactos-comerciales-2026-10'; email (+ normalized), first/last name,
 *     company (+ company_key through company_alias), phone(s). email_status
 *     'probable', status 'new'.
 *   - EXISTING contact: fill-empty phone ONLY, plus one person_property_history
 *     row per filled column (source 'import'). A contact that already has any
 *     number is skipped and counted. Name, company, owner and status are never
 *     touched.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - No sticky owner: it writes no history row with property 'ownerBdId' and
 *     source 'edit', so the automatic last-worked rule still governs these
 *     contacts.
 *   - No activity rows. "ULTIMO CONTACTO" is mail sent from the CEO's mailbox,
 *     not by a BD here; inventing activity would fake history and queue the
 *     contacts for follow-up. The date is reported (count) and stored nowhere.
 *   - No company rows are created.
 *
 * PHONES: the PDF does not say landline or mobile. The first valid number goes
 * to `phone`, a second one to `mobile_phone`; the column names carry no
 * meaning here (not known whether the first PDF number is usually the mobile). Numbers are validated with src/lib/phone.ts. An extension
 * ("ext 1016") is DROPPED so tel: and WhatsApp links keep working (counted in
 * the report); a rejected number stores nothing (counted).
 *
 * INFERRED NAMES: rows whose surname cell reads "(inferido del mail)" are
 * loaded, and each new contact gets a person_property_history row
 * property 'nameInferred', new_value 'email', source 'import'. Find them with:
 *   SELECT person_id FROM person_property_history WHERE property = 'nameInferred';
 * A marker-only surname cell is not stored as a surname (last_name stays NULL).
 *
 * IDEMPOTENT: a re-run matches the created contacts by email (no duplicates)
 * and sees filled phones as "already has one" (no re-fill).
 *
 * REVERT: use scripts/revert-contactos-comerciales-2026-10.ts (dry run by
 * default). Do NOT hand-write DELETEs: every table that references person
 * cascades on delete, so an unguarded DELETE would also destroy activities,
 * tasks and notes a BD logged on these contacts after the import. The one
 * audit_log row (action 'import_contactos_comerciales_2026_10') carries the
 * createdPersonIds and filledPersonIds that script reads.
 *
 * EXIT CODES: 0 success (dry run or write); 1 bad arguments, parse failure
 * (zero contacts found), missing bd, or any failed check (nothing written).
 *
 * Usage (do NOT run --execute automatically: this touches the real database):
 *   npx tsx --env-file=.env.local scripts/import-contactos-comerciales-2026-10.ts <backups/contactos.txt>
 *   npx tsx --env-file=.env.local scripts/import-contactos-comerciales-2026-10.ts <backups/contactos.txt> --execute --actor=<bd id>
 */
import { readFileSync } from "node:fs";
import { dryRunComerciales, executeComerciales } from "../src/lib/contactosComerciales/db";
import { parseComerciales } from "../src/lib/contactosComerciales/parse";
import { formatComercialReport } from "../src/lib/contactosComerciales/report";

function parseArgs(argv: readonly string[]) {
  let path: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (!arg.startsWith("--") && !path) path = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!path) throw new Error("Usage: import-contactos-comerciales-2026-10.ts <pdftotext output> [--execute --actor=<bd id>]");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { path, execute, actor };
}

async function main() {
  const { path, execute, actor } = parseArgs(process.argv.slice(2));
  const rows = parseComerciales(readFileSync(path, "utf-8"));
  if (!rows.length) throw new Error("No contacts found: is this the `pdftotext -layout` output of the PDF?");

  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    console.log(formatComercialReport(await dryRunComerciales(rows)).join("\n"));
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  const { plan, auditLogId } = await executeComerciales(rows, actor!);
  console.log(formatComercialReport(plan).join("\n"));
  console.log(auditLogId ? `\nWrote ${plan.creates.length} person(s) and filled ${plan.fills.length}. audit_log id: ${auditLogId}` : "\nNothing to write (already imported).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
