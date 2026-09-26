/**
 * One-off, owner-gated safety-net backfill: fills `company.domain` for
 * existing companies whose domain is still empty, re-deriving the exact
 * same name/compact-key matches `planCompanyResolution` already computes
 * (src/lib/hubspot/companies.ts) from a LOCAL HubSpot companies export CSV
 * (never a live HubSpot read, never the `hubspot/` PII-bearing folder).
 *
 * Follow-up to the hubspot-import execute-report bug (prod run c9de8587):
 * `finalizeHubSpotExecute` used to persist the planner's raw report, which
 * dropped `domainFilledCompanyKeys` entirely, so the owner had no reliable
 * evidence of whether the 131 name/compact-matched existing companies from
 * that run actually got their domain filled at execute time. Root cause
 * (see companies.ts) was `planCompanyResolution` mutating its own
 * `existingCompanies` input, silently swallowing fills across a repeated
 * call — that's fixed too. This script is the safety net: it is idempotent
 * (only ever touches a company whose `domain` is currently NULL) and safe
 * to run any number of times, whether or not the original execute already
 * filled anything.
 *
 * Reuses `planCompanyResolution` directly (not a re-implementation, and
 * called exactly ONCE per run — no risk of the repeated-call bug above) so
 * the matches and the claimed-domain conflict guard (see
 * src/lib/hubspot/companies.ts#domainClaimedByOtherCompany) are IDENTICAL
 * to what the live import already runs — a claimed domain is reported as a
 * conflict and never attempted as a write.
 *
 * `--execute` hardening (requested before the owner approves a real run,
 * after a read-only dry run against prod reported 986 fills / 63
 * conflicts):
 *   1. All or nothing — every UPDATE and the audit_log INSERT run inside
 *      ONE `db.transaction`. If any UPDATE throws (e.g. the partial unique
 *      index `company_domain_idx`, in the narrow race window where a
 *      domain gets claimed by someone else between this script's own CSV
 *      re-derivation and the write), Postgres rolls back the whole
 *      transaction — no partial writes.
 *   2. Audit trail — one `audit_log` row (action `company_domain_backfill`)
 *      in the SAME transaction, following the exact `--actor=<bd id>`
 *      convention scripts/backfill-connection-signals.ts already
 *      established for one-off writes with no natural BD actor context.
 *      Metadata: fillsPlanned/fillsApplied/fillsSkippedRace/
 *      conflictsSkipped and the applied companyKeys list (capped — see
 *      src/lib/hubspot/companyDomainBackfillAudit.ts). Company
 *      names/keys are business data, not personal PII (see
 *      src/lib/hubspot/report.ts's own documented rationale), so they're
 *      safe to persist here — this is what makes a revert possible.
 *   3. Re-check before writing — each UPDATE keeps its defensive
 *      `WHERE domain IS NULL` re-check (on top of the in-memory
 *      `!matched.domain` check `planCompanyResolution` already did against
 *      the snapshot read above). If a company's domain is no longer empty
 *      by write time (claimed by something else since the read), that
 *      UPDATE matches zero rows — no throw, no silent drop: it's counted
 *      as `fillsSkippedRace` and reported on stdout and in the audit row.
 *      `fillsApplied` is verified against `fills.length` after the loop;
 *      any gap is explained by `fillsSkippedRace`, never swallowed.
 *   4. Output — stdout prints ONLY counts, never a company name, key, or
 *      domain. The dry-run output is unchanged.
 *
 * A pg_dump backup is NOT required for this fill-empty-only update (it
 * only ever sets a currently-NULL column, never overwrites or deletes
 * anything). To revert a completed `--execute` run, read the audit_log
 * row's metadata (`action = 'company_domain_backfill'`) and run:
 *   update company set domain = null where company_key in (<companyKeys from that row>);
 * (if `companyKeysTruncated` is true, re-derive the full set by re-running
 * this script's dry run against the SAME CSV and DB state instead of
 * relying on the capped list.)
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--execute --actor=<bd
 * id>` to actually write. Requires DATABASE_URL to be set (see .env).
 *
 * Usage:
 *   npx tsx scripts/backfill-company-domains.ts --csv=<path-to-companies.csv>                               # dry run (default)
 *   npx tsx scripts/backfill-company-domains.ts --csv=<path-to-companies.csv> --execute --actor=<bd id>      # writes
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, company } from "../src/db/schema";
import { parseHubSpotCsv } from "../src/lib/hubspot/parse";
import { REQUIRED_COMPANY_HEADERS } from "../src/lib/hubspot/columns";
import { mapHubSpotCompanyRow, planCompanyResolution, type HubSpotCompanyRow } from "../src/lib/hubspot/companies";
import { readExistingCompanies } from "../src/lib/hubspot/companyQueries";
import { buildCompanyDomainBackfillAuditMetadata } from "../src/lib/hubspot/companyDomainBackfillAudit";

interface Args {
  csv: string | null;
  execute: boolean;
  actor: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let csv: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false; // explicit no-op, dry-run is already the default
    else if (arg.startsWith("--csv=")) csv = arg.slice("--csv=".length);
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
  }
  return { csv, execute, actor };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csv) {
    throw new Error(
      "Usage: npx tsx scripts/backfill-company-domains.ts --csv=<path> [--execute --actor=<bd id>]",
    );
  }
  if (args.execute && !args.actor) {
    throw new Error("--execute requires --actor=<bd id> for the audit log");
  }

  const companyRecords = await parseHubSpotCsv(args.csv, REQUIRED_COMPANY_HEADERS);
  const companies: HubSpotCompanyRow[] = companyRecords.map(mapHubSpotCompanyRow);
  const existingCompanies = await readExistingCompanies();

  // No contacts CSV involved (task 2.1's original company-creation
  // eligibility gate — "primary contact" / "has a note" — is irrelevant
  // here: this script never creates a company, only fills an EXISTING,
  // already-empty domain), so primary-contact counts and existing note ids
  // are both empty. That does not affect domain-fill matching at all — see
  // planCompanyResolution: the create-eligibility gate only guards
  // `companiesToCreate`, never `domainFills`. Called exactly ONCE — see
  // companies.ts's header for why calling it more than once against the
  // SAME existingCompanies array used to silently swallow fills.
  const companyResolution = planCompanyResolution(companies, existingCompanies, new Map(), new Set());

  const fills = companyResolution.domainFills;
  const conflicts = companyResolution.domainConflicts;

  console.log(`Companies read from CSV: ${companies.length}`);
  console.log(`Existing companies read from DB: ${existingCompanies.length}`);
  console.log(`Domain fills found: ${fills.length}`);
  console.log(`Domain conflicts found (skipped — domain already claimed by a different company): ${conflicts.length}`);

  if (!args.execute) {
    console.log("Dry run only — no writes performed. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const appliedCompanyKeys: string[] = [];
  const skippedRaceCompanyKeys: string[] = [];

  await db.transaction(async (tx) => {
    for (const fill of fills) {
      // Re-check before writing: on top of the in-memory `!matched.domain`
      // check planCompanyResolution already did against the snapshot read
      // above, re-verify against the LIVE row at write time. If the domain
      // is no longer empty (claimed by something else since the read),
      // this matches zero rows — no throw, no silent drop, counted below.
      const [updated] = await tx
        .update(company)
        .set({ domain: fill.domain })
        .where(and(eq(company.companyKey, fill.companyKey), isNull(company.domain)))
        .returning({ companyKey: company.companyKey });
      if (updated) appliedCompanyKeys.push(updated.companyKey);
      else skippedRaceCompanyKeys.push(fill.companyKey);
    }

    const metadata = buildCompanyDomainBackfillAuditMetadata({
      fillsPlanned: fills.length,
      appliedCompanyKeys,
      skippedRaceCompanyKeys,
      conflictsSkipped: conflicts.length,
    });
    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: "company_domain_backfill",
      metadata,
    });
  });

  console.log(`Applied ${appliedCompanyKeys.length} domain fill(s).`);
  if (skippedRaceCompanyKeys.length) {
    console.log(
      `${skippedRaceCompanyKeys.length} planned fill(s) were skipped — their domain was already set by ` +
        "something else between the read and this execute (see audit_log for the exact set).",
    );
  }
  if (appliedCompanyKeys.length !== fills.length) {
    console.log(
      `Applied (${appliedCompanyKeys.length}) does not equal planned (${fills.length}) — ` +
        `fully explained by the ${skippedRaceCompanyKeys.length} skipped above.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
