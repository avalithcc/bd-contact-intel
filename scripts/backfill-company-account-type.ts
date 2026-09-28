/**
 * One-off, owner-gated backfill loading the Airtable "SEGUIMIENTO de
 * cuentas MATÍAS & MACARENA" account-tracking export (two CSVs — a Grid
 * view and a "Cuentas Pablo" view, both `Cuenta,Assignee,Status,
 * Categoría,Notes,Created,Estado 2,Contratos & Documentos`) into
 * `company.account_type` and `company.notes` (migration 0018).
 *
 * Requires migration 0018 (company-account-type) to already be applied —
 * `company.account_type` must exist before this script can write to it.
 *
 * What this writes, and why (see src/lib/accounts/accountTypeBackfill.ts
 * for the full field-by-field rationale):
 *   - `Categoría` -> `company.account_type` ('partner' | 'client' |
 *     'strategic_org') on EVERY resolved account, new or existing. This is
 *     a relationship TYPE, deliberately not `relationshipStage` (the sales
 *     pipeline) — see the design decision recorded on the schema column.
 *   - `Notes` -> `company.notes`, FILL-EMPTY ONLY for existing companies
 *     (a company whose `notes` already holds text is never overwritten —
 *     reported as `notesSkippedNonEmpty`, matching how this repo has
 *     treated merges elsewhere). Always set for newly created companies
 *     (there is nothing to preserve).
 *   - `Status`, `Created`, `Estado 2`, `Contratos & Documentos`, and
 *     `Assignee` are intentionally DROPPED — never persisted anywhere.
 *     `Status` is "In progress" on every single row (zero information).
 *     `Created` is an Airtable bookkeeping date with no honest home on
 *     `company` (it is not a first-contact date, and backdating
 *     `company.createdAt` would misrepresent when the record actually
 *     entered THIS system). `Estado 2` ("Sin proceso activo" / "Proceso
 *     activo iniciado") reads like a pipeline signal, but mapping it to
 *     `relationshipStage` is explicitly out of scope for this change — see
 *     the schema decision above; flagging it here as a candidate follow-up
 *     rather than inventing a home for it. `Contratos & Documentos` holds
 *     a handful of Airtable-hosted attachment URLs (NDAs/MSAs) that are
 *     likely to expire outside Airtable and have no dedicated `company`
 *     column; a future dedicated field/table is a reasonable follow-up if
 *     the owner wants to keep them.
 *   - `Assignee` ("Matias Abaro" / "Pablo Garcia") is dropped: both left
 *     the company and are not `bd` rows here — no `owner_bd_id` is ever
 *     set by this script.
 *
 * Two Airtable rows can describe the SAME real account under slightly
 * different names — see `ACCOUNT_NAME_ALIASES` (Winclamp/Winclap, caught
 * by both rows referencing the same `lorenzo.ussher@winclap.com`). This
 * script also runs `findCrossNameEmailDomainOverlaps` over every OTHER
 * merged account and prints any additional overlap it finds, so a new
 * near-duplicate doesn't silently create a second company for an account
 * that already exists under another spelling.
 *
 * Two rows can also disagree on `Categoría` for the SAME account name
 * (this export has exactly one such case: "Dynamic Tours" is "Org.
 * estratégica" in the Grid view, dated 23/5/2024, vs "Cliente" in the
 * Pablo view, dated 16/11/2023) — resolved by the row with the LATEST
 * `Created` date (dry run prints every such conflict so the owner can
 * decide before approving `--execute`).
 *
 * Sometimes the tie-break above still gets it wrong, because BOTH source
 * rows were wrong (not disagreeing-but-one-right — actually wrong). For
 * that, `src/lib/accounts/accountTypeBackfill.ts#ACCOUNT_TYPE_OVERRIDES`
 * holds a small, explicit, human-adjudicated override map, applied AFTER
 * normal `Categoría` resolution. Its one entry today: "Dynamic Tours" is a
 * `partner` (owner adjudicated 2026-09-28), overriding whatever the
 * conflict tie-break above computed. Every override is printed on BOTH the
 * dry run and `--execute` (never silent) and recorded in the `audit_log`
 * row on execute, so the stored history says the value came from a human
 * decision, not from the disagreeing CSVs. If `ACCOUNT_TYPE_OVERRIDES`
 * names an account that isn't in this run's input at all (a typo, or an
 * account that no longer appears in the CSVs), this script throws instead
 * of silently doing nothing.
 *
 * `--execute` hardening, matching scripts/backfill-company-domains.ts:
 *   1. All or nothing — every INSERT/UPDATE and the audit_log INSERT run
 *      inside ONE `db.transaction`, batched (never row by row).
 *   2. Audit trail — one `audit_log` row (action
 *      `company_account_type_backfill`) in the SAME transaction. Metadata
 *      via buildAccountTypeBackfillAuditMetadata (companyKeys capped —
 *      see src/lib/accounts/accountTypeBackfillAudit.ts). Company
 *      names/keys are business data, not PII, so they're safe to persist
 *      for the revert path documented there.
 *   3. Existing companies are looked up ONCE, by the full set of resolved
 *      `companyKey`s (readExistingCompaniesForAccountType) — never a
 *      per-row query.
 *
 * A pg_dump backup is NOT strictly required (creates are net-new rows;
 * `account_type` only ever moves from NULL on a brand-new column; `notes`
 * fills only ever move from NULL). To revert a completed `--execute` run,
 * read the audit_log row's metadata (`action =
 * 'company_account_type_backfill'`) and run the three statements
 * documented in accountTypeBackfillAudit.ts's header.
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--execute
 * --actor=<bd id>` to actually write. Requires DATABASE_URL to be set
 * (see .env).
 *
 * Usage:
 *   npx tsx scripts/backfill-company-account-type.ts --grid=<path> --pablo=<path>
 *   npx tsx scripts/backfill-company-account-type.ts --grid=<path> --pablo=<path> --execute --actor=<bd id>
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, company } from "../src/db/schema";
import { parseHubSpotCsv } from "../src/lib/hubspot/parse";
import {
  extractEmails,
  findCrossNameEmailDomainOverlaps,
  mapAccountCsvRow,
  mergeAccountRows,
  planAccountTypeWrites,
  type RawAccountRow,
} from "../src/lib/accounts/accountTypeBackfill";
import { readExistingCompaniesForAccountType } from "../src/lib/accounts/accountQueries";
import { buildAccountTypeBackfillAuditMetadata } from "../src/lib/accounts/accountTypeBackfillAudit";
import { chunk } from "../src/lib/migration/collapseWriteRows";

const REQUIRED_HEADERS = ["Cuenta", "Categoría", "Notes", "Created"] as const;
const WRITE_BATCH_SIZE = 200;

interface Args {
  grid: string | null;
  pablo: string | null;
  execute: boolean;
  actor: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let grid: string | null = null;
  let pablo: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false; // explicit no-op, dry-run is already the default
    else if (arg.startsWith("--grid=")) grid = arg.slice("--grid=".length);
    else if (arg.startsWith("--pablo=")) pablo = arg.slice("--pablo=".length);
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
  }
  return { grid, pablo, execute, actor };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.grid || !args.pablo) {
    throw new Error(
      "Usage: npx tsx scripts/backfill-company-account-type.ts --grid=<path> --pablo=<path> [--execute --actor=<bd id>]",
    );
  }
  if (args.execute && !args.actor) {
    throw new Error("--execute requires --actor=<bd id> for the audit log");
  }

  const [gridRecords, pabloRecords] = await Promise.all([
    parseHubSpotCsv(args.grid, REQUIRED_HEADERS),
    parseHubSpotCsv(args.pablo, REQUIRED_HEADERS),
  ]);

  const rawRows: RawAccountRow[] = [
    ...gridRecords.map((r) => mapAccountCsvRow(r, "grid")),
    ...pabloRecords.map((r) => mapAccountCsvRow(r, "pablo")),
  ];

  const { accounts, conflicts, appliedOverrides } = mergeAccountRows(rawRows);

  console.log(`CSV rows read: ${rawRows.length} (grid: ${gridRecords.length}, pablo: ${pabloRecords.length})`);
  console.log(`Distinct real accounts after alias fold: ${accounts.length}`);

  if (conflicts.length) {
    console.log(`Categoría conflicts resolved by latest Created date (${conflicts.length}):`);
    for (const c of conflicts) {
      console.log(`  - ${c.displayName}: ${JSON.stringify(c.candidates)} -> resolved "${c.resolvedCategory}"`);
    }
  }

  // Owner overrides are never silent — printed on EVERY run (dry run and
  // execute alike), even when a conflict above already explains why the
  // normal resolution disagreed with itself. Both facts matter.
  if (appliedOverrides.length) {
    console.log(`Owner override(s) applied (${appliedOverrides.length}):`);
    for (const o of appliedOverrides) {
      console.log(
        `  - "${o.displayName}" (${o.companyKey}): resolved "${o.previousAccountType}" -> overridden to ` +
          `"${o.accountType}". Reason: ${o.reason}`,
      );
    }
  }

  const overlaps = findCrossNameEmailDomainOverlaps(accounts);
  if (overlaps.length) {
    console.log(`Cross-name email domain overlaps found (possible unresolved duplicates, ${overlaps.length}):`);
    for (const o of overlaps) console.log(`  - ${o.domain}: ${o.displayNames.join(", ")}`);
  } else {
    console.log("No cross-name email domain overlaps found beyond the known Winclamp/Winclap fold.");
  }

  const distinctEmails = new Set<string>();
  for (const acc of accounts) {
    if (acc.notes) for (const e of extractEmails(acc.notes)) distinctEmails.add(e);
  }
  console.log(
    `Distinct email addresses found in Notes text (out of scope to create contacts from — follow-up only): ${distinctEmails.size}`,
  );

  const existingByKey = await readExistingCompaniesForAccountType(accounts.map((a) => a.companyKey));
  const plan = planAccountTypeWrites(accounts, existingByKey);

  console.log(`Companies to create: ${plan.companiesToCreate.length}`);
  for (const c of plan.companiesToCreate) console.log(`  - ${c.displayName} (${c.companyKey}) -> ${c.accountType}`);
  console.log(`Existing companies to get account_type set: ${plan.existingAccountTypeUpdates.length}`);
  console.log(`Existing companies to get notes filled (was empty): ${plan.existingNotesFills.length}`);
  console.log(
    `Existing companies whose notes were already non-empty — skipped, not overwritten: ${plan.existingNotesSkipped.length}`,
  );
  if (plan.existingNotesSkipped.length) {
    console.log(`  - ${plan.existingNotesSkipped.map((s) => s.companyKey).join(", ")}`);
  }

  if (!args.execute) {
    console.log("Dry run only — no writes performed. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const createdCompanyKeys: string[] = [];
  const accountTypeUpdatedCompanyKeys: string[] = [];
  const notesFilledCompanyKeys: string[] = [];

  await db.transaction(async (tx) => {
    for (const batch of chunk(plan.companiesToCreate, WRITE_BATCH_SIZE)) {
      if (!batch.length) continue;
      const inserted = await tx
        .insert(company)
        .values(
          batch.map((c) => ({
            companyKey: c.companyKey,
            displayName: c.displayName,
            accountType: c.accountType,
            notes: c.notes,
          })),
        )
        .onConflictDoNothing({ target: company.companyKey })
        .returning({ companyKey: company.companyKey });
      createdCompanyKeys.push(...inserted.map((r) => r.companyKey));
    }

    for (const update of plan.existingAccountTypeUpdates) {
      const [updated] = await tx
        .update(company)
        .set({ accountType: update.accountType })
        .where(eq(company.companyKey, update.companyKey))
        .returning({ companyKey: company.companyKey });
      if (updated) accountTypeUpdatedCompanyKeys.push(updated.companyKey);
    }

    for (const fill of plan.existingNotesFills) {
      const [updated] = await tx
        .update(company)
        .set({ notes: fill.notes })
        .where(and(eq(company.companyKey, fill.companyKey), isNull(company.notes)))
        .returning({ companyKey: company.companyKey });
      if (updated) notesFilledCompanyKeys.push(updated.companyKey);
    }

    const metadata = buildAccountTypeBackfillAuditMetadata({
      createdCompanyKeys,
      accountTypeUpdatedCompanyKeys,
      notesFilledCompanyKeys,
      notesSkippedNonEmpty: plan.existingNotesSkipped.length,
      overridesApplied: appliedOverrides,
    });
    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: "company_account_type_backfill",
      metadata,
    });
  });

  console.log(`Created ${createdCompanyKeys.length} company row(s).`);
  console.log(`Set account_type on ${accountTypeUpdatedCompanyKeys.length} existing company row(s).`);
  console.log(`Filled notes on ${notesFilledCompanyKeys.length} existing company row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
