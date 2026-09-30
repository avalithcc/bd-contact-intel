/**
 * Owner-run import of the Digital Finance Forum 2026 attendee list
 * (source_key 'dff-2026'), owned by Mariel Meza — see
 * src/lib/dff2026/{buildAttendeeRecords,planImport,db}.ts for the actual
 * parsing/planning/write logic this just wires together.
 *
 * SCOPE (owner decision 2026-09-30): `--scope=all` (default) imports EVERY
 * valid row — registrants and attendees alike — so Mariel has the whole
 * list; `--scope=attended` imports ONLY the rows with ASISTIÓ="1". Either
 * way, attendance itself is recorded (one `event_attendance` activity) for
 * every row that DID attend, so it's never lost regardless of scope.
 *
 * PHONE (owner decision 2026-09-30): CELULAR is the most important field in
 * this file. Stored RAW (trimmed/control-stripped only) in `mobile_phone` —
 * never reformatted, never prefixed with +54 — validated with
 * `isValidPhoneFormat` (src/lib/phone.ts) so a bad value is left empty
 * (contact not dropped) rather than writing a dead `tel:` link.
 *
 * OWNER (owner reconfirmation 2026-09-30): every contact from this file
 * ends up owned by Mariel, unconditionally — including the 9 that already
 * exist in the CRM. There is no "leave existing owner" flag; this is a
 * hard, checked postcondition (src/lib/dff2026/db.ts#executeDffImport), not
 * an assumption.
 *
 * Dry-run by DEFAULT; `--execute --actor=<bd id>` writes. `--revert`
 * (add `--execute --actor=<bd id>` to apply) undoes exactly one prior
 * `dff_2026_import` audit_log row.
 *
 * Usage (do NOT run automatically — this touches the real database):
 *   npx tsx --env-file=.env.local scripts/import-dff-2026.ts [csvPath]                              # dry run, scope=all
 *   npx tsx --env-file=.env.local scripts/import-dff-2026.ts [csvPath] --scope=attended              # dry run, attendees only
 *   npx tsx --env-file=.env.local scripts/import-dff-2026.ts [csvPath] --execute --actor=<bd id>     # writes
 *   npx tsx --env-file=.env.local scripts/import-dff-2026.ts --revert                                # revert dry run
 *   npx tsx --env-file=.env.local scripts/import-dff-2026.ts --revert --execute --actor=<bd id>       # applies the revert
 *
 * Requires DATABASE_URL (see .env) — no environment guard of its own.
 */
import { readFileSync } from "node:fs";
import { buildAttendeeRecords, type BuildAttendeeRecordsResult } from "../src/lib/dff2026/buildAttendeeRecords";
import { dryRunDffImport, executeDffImport, executeDffRevert, readDffAuditRows } from "../src/lib/dff2026/db";
import { selectDffAuditRow, type DffImportPlan, type ImportScope } from "../src/lib/dff2026/planImport";

const DEFAULT_CSV_PATH = 'backups/listado_final_digital_finance_forum.xlsx - Inscriptos presenciales.csv';

interface Args {
  csvPath: string;
  scope: ImportScope;
  execute: boolean;
  actor: string | null;
  revert: boolean;
  auditId: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let csvPath = DEFAULT_CSV_PATH;
  let scope: ImportScope = "all";
  let execute = false;
  let actor: string | null = null;
  let revert = false;
  let auditId: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false;
    else if (arg === "--revert") revert = true;
    else if (arg === "--scope=all") scope = "all";
    else if (arg === "--scope=attended") scope = "attended";
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--audit-id=")) auditId = arg.slice("--audit-id=".length);
    else if (!arg.startsWith("--")) csvPath = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { csvPath, scope, execute, actor, revert, auditId };
}

function printDryRunReport(plan: DffImportPlan, parseStats: BuildAttendeeRecordsResult) {
  const r = plan.report;
  console.log(`Rows parsed: ${parseStats.rowsParsed}`);
  console.log(`Skipped (no valid EMAIL): ${parseStats.skippedNoEmail}`);
  console.log(`In-file duplicate emails collapsed: ${parseStats.duplicateEmailCollisions.length}`);
  console.log(`Rows in scope: ${r.rowsInScope} (excluded by --scope: ${r.rowsExcludedByScope})`);
  console.log("");
  console.log(`New persons to create: ${r.created}`);
  console.log(`Existing persons matched (by email): ${r.existingMatched}`);
  console.log(`  of which newly owned (was unassigned) -> Mariel: ${r.existingNewlyOwned}`);
  console.log(`  of which reassigned FROM another BD -> Mariel: ${r.existingReassignedFromOtherBd.length}`);
  for (const rr of r.existingReassignedFromOtherBd) console.log(`    ${rr.personId} <- ${rr.previousOwnerName}`);
  console.log("");
  console.log(`Companies matched (existing): ${r.companiesMatched}`);
  console.log(`Companies to create: ${r.companiesCreated}`);
  console.log("");
  console.log("Role group distribution:");
  for (const [group, count] of Object.entries(r.roleGroupDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${group}: ${count}`);
  }
  console.log("");
  console.log(`Phones written: ${r.phonesWritten}`);
  console.log(`Phones rejected: ${r.phonesRejected.length}`);
  for (const p of r.phonesRejected) console.log(`  ${p.email}: "${p.raw}" (${p.reason})`);
  console.log("Phone digit-length histogram (all rows with a CELULAR value):");
  for (const [len, count] of Object.entries(r.phoneDigitLengthHistogram).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  ${len} digits: ${count}`);
  }
  console.log("");
  console.log(`Attendance to record: ${r.attendanceToRecord} (already recorded: ${r.attendanceAlreadyRecorded})`);
  console.log("");
  console.log(`Sample of ${r.sample.length} planned contacts:`);
  for (const s of r.sample) {
    console.log(`  [${s.isNew ? "new" : "existing"}] ${s.firstName ?? ""} ${s.lastName ?? ""} <${s.email}> — ${s.company ?? "no company"} — ${s.jobTitle ?? "no title"} — attended=${s.attended}`);
  }
}

async function runImport(args: Args) {
  const raw = readFileSync(args.csvPath, "utf-8");
  const parsed = buildAttendeeRecords(raw);

  if (!args.execute) {
    const plan = await dryRunDffImport(parsed.records, args.scope);
    printDryRunReport(plan, parsed);
    console.log("");
    console.log("Dry run only — no writes performed. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const { plan, auditLogId } = await executeDffImport(parsed.records, args.scope, args.actor!);
  printDryRunReport(plan, parsed);
  console.log("");
  console.log(`Wrote ${plan.creates.length} new person(s), updated ${plan.updates.length} existing person(s), recorded ${plan.attendance.length} attendance activity(ies).`);
  console.log(`audit_log id: ${auditLogId}`);
  console.log(`Revert with: npx tsx --env-file=.env.local scripts/import-dff-2026.ts --revert --execute --actor=<bd id> --audit-id=${auditLogId}`);
}

async function runRevert(args: Args) {
  const rows = await readDffAuditRows();
  const selection = selectDffAuditRow(rows, args.auditId);

  if (selection.kind === "none") {
    console.log("No dff_2026_import audit_log row found — nothing to revert.");
    return;
  }
  if (selection.kind === "not_found") {
    throw new Error(`--audit-id=${selection.requestedAuditId} does not match any dff_2026_import audit_log row.`);
  }
  if (selection.kind === "ambiguous") {
    const lines = [
      "More than one dff_2026_import audit_log row exists — refusing to guess which one to revert.",
      "Re-run with --audit-id=<uuid> to choose one explicitly:",
      selection.candidates.map((c) => `  ${c.id} — at=${c.at.toISOString()} actor=${c.actorBdId}`).join("\n"),
    ];
    throw new Error(lines.join("\n"));
  }

  const audit = selection.row;
  console.log(`Reverting audit_log row ${audit.id} (created ${audit.metadata.createdPersonIds.length}, updated ${new Set(audit.metadata.updatedHistoryRows.map((h) => h.personId)).size}).`);

  if (!args.execute) {
    console.log("");
    console.log("Revert dry run only — no writes performed. Re-run with --revert --execute --actor=<bd id> to apply.");
    return;
  }

  const result = await executeDffRevert(audit, args.actor!);
  console.log(`Deleted ${result.deletedPersonIds.length} created person(s).`);
  console.log(`Deleted ${result.deletedCompanyKeys.length} company(ies) this run created and nothing else references.`);
  console.log(`Deleted ${result.deletedAttendanceActivityIds.length} attendance activity(ies).`);
  console.log("Reverted fields (property: count reverted / count skipped due to a later edit):");
  for (const [property, count] of Object.entries(result.revertedByProperty)) {
    console.log(`  ${property}: ${count} reverted / ${result.skippedByProperty[property] ?? 0} skipped`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.execute && !args.actor) {
    throw new Error("--execute requires --actor=<bd id> for the audit log");
  }
  if (args.revert) await runRevert(args);
  else await runImport(args);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
