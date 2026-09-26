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
 * that run actually got their domain filled at execute time. That report
 * bug is now fixed (see src/lib/hubspot/report.ts / importQueries.ts), but
 * it cannot retroactively tell us what happened in the ALREADY-EXECUTED
 * run. This script is the safety net: it is idempotent (only ever touches a
 * company whose `domain` is currently NULL) and safe to run any number of
 * times, whether or not the original execute already filled anything.
 *
 * Reuses `planCompanyResolution` directly (not a re-implementation) so the
 * matches and the claimed-domain conflict guard (see
 * src/lib/hubspot/companies.ts#domainClaimedByOtherCompany) are IDENTICAL
 * to what the live import already runs — a claimed domain is reported as a
 * conflict and never attempted as a write, so this can never violate the
 * partial unique index `company_domain_idx` or abort mid-run.
 *
 * PII rule: prints ONLY counts, never a company name or key — this is a
 * write to `company.domain`, not `person`, but we still never assume
 * business data is fine to print without being asked. Never reads/logs
 * anything under a `hubspot/` folder.
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--execute` to actually
 * write. Requires DATABASE_URL to be set (see .env).
 *
 * Usage:
 *   npx tsx scripts/backfill-company-domains.ts --csv=<path-to-companies.csv>              # dry run (default)
 *   npx tsx scripts/backfill-company-domains.ts --csv=<path-to-companies.csv> --execute     # writes
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { company } from "../src/db/schema";
import { parseHubSpotCsv } from "../src/lib/hubspot/parse";
import { REQUIRED_COMPANY_HEADERS } from "../src/lib/hubspot/columns";
import { mapHubSpotCompanyRow, planCompanyResolution, type HubSpotCompanyRow } from "../src/lib/hubspot/companies";
import { readExistingCompanies } from "../src/lib/hubspot/companyQueries";

interface Args {
  csv: string | null;
  execute: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let csv: string | null = null;
  let execute = false;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false; // explicit no-op, dry-run is already the default
    else if (arg.startsWith("--csv=")) csv = arg.slice("--csv=".length);
  }
  return { csv, execute };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csv) {
    throw new Error("Usage: npx tsx scripts/backfill-company-domains.ts --csv=<path> [--execute]");
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
  // `companiesToCreate`, never `domainFills`.
  const companyResolution = planCompanyResolution(companies, existingCompanies, new Map(), new Set());

  const fills = companyResolution.domainFills;
  const conflicts = companyResolution.domainConflicts;

  console.log(`Companies read from CSV: ${companies.length}`);
  console.log(`Existing companies read from DB: ${existingCompanies.length}`);
  console.log(`Domain fills found: ${fills.length}`);
  console.log(`Domain conflicts found (skipped — domain already claimed by a different company): ${conflicts.length}`);

  if (!args.execute) {
    console.log("Dry run only — no writes performed. Re-run with --execute to apply.");
    return;
  }

  let applied = 0;
  for (const fill of fills) {
    // Defensive `WHERE domain IS NULL` re-check at write time (in addition
    // to the in-memory `!matched.domain` check `planCompanyResolution`
    // already did against the snapshot read above) — never overwrites a
    // domain that got set by anything else between the read and this write.
    const [updated] = await db
      .update(company)
      .set({ domain: fill.domain })
      .where(and(eq(company.companyKey, fill.companyKey), isNull(company.domain)))
      .returning({ companyKey: company.companyKey });
    if (updated) applied++;
  }
  console.log(`Applied ${applied} domain fill(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
