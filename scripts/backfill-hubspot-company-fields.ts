/**
 * Fill-empty backfill of `company.industry` / `company.owner_bd_id` /
 * `company.city` / `company.country` from a HubSpot companies export
 * (company-fields change, owner-approved 2026-09-26). Mirrors
 * scripts/backfill-hubspot-phones.ts's shape:
 *
 *   - "Sector" -> industry, "Ciudad" -> city, "País/región" -> country,
 *     "Propietario del registro de empresa" -> owner_bd_id (owner mapping,
 *     src/lib/hubspot/owners.ts#matchHubSpotOwner — same accent-insensitive
 *     name match the contacts import uses; deactivated or unknown owners
 *     resolve to null and are never written).
 *   - Companies are matched the SAME way the main HubSpot import matches
 *     them: src/lib/hubspot/companies.ts#planCompanyResolution, fed the
 *     existing `company` snapshot (domain/companyKey) — this backfill only
 *     ever fills an EXISTING company, it never creates one (empty
 *     `primaryContactCounts`/`existingNoteHubspotCompanyIds` mean the
 *     planner's creation branch always falls through to "unresolved").
 *   - Fill-empty only: src/lib/hubspot/companyFieldsBackfill.ts#planCompanyFieldsBackfill
 *     never overwrites a column that already has a value.
 *
 * Defaults to a DRY RUN that only prints counts (rows in file / resolved /
 * unresolved / companies matched / would-update / per-field fill counts) —
 * never row-level data, since the CSV is PII. Pass --execute with
 * --actor=<bd id> to write, in ONE transaction plus ONE audit_log row
 * carrying the revert keys (the list of companyKeys touched, plus what was
 * filled — for a manual revert query, never printed to the console).
 *
 * Usage (do NOT run automatically — this reads the real CSV path and, on
 * --execute, writes the real database; requires migration 0017 applied):
 *   npx tsx --env-file=.env.local scripts/backfill-hubspot-company-fields.ts --file=hubspot/todas-las-empresas.csv
 *   npx tsx --env-file=.env.local scripts/backfill-hubspot-company-fields.ts --file=hubspot/todas-las-empresas.csv --execute --actor=<bd id>
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, bd } from "../src/db/schema";
import { parseHubSpotCsv } from "../src/lib/hubspot/parse";
import { mapHubSpotCompanyRow, planCompanyResolution } from "../src/lib/hubspot/companies";
import { readExistingCompanies, readExistingCompanyFields } from "../src/lib/hubspot/companyQueries";
import { matchHubSpotOwner } from "../src/lib/hubspot/owners";
import {
  mapCompanyFieldsBackfillRow,
  planCompanyFieldsBackfill,
  type CompanyFieldsBackfillRow,
} from "../src/lib/hubspot/companyFieldsBackfill";

const REQUIRED_HEADERS = [
  "ID de registro",
  "Nombre de la empresa",
  "Nombre de dominio de la empresa",
  "Sector",
  "Ciudad",
  "País/región",
  "Propietario del registro de empresa",
] as const;

interface CliArgs {
  file: string;
  execute: boolean;
  actor: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  let file: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --file=<path>, --execute, --actor=<bd id>`);
  }
  if (!file) throw new Error("--file=<path to HubSpot companies CSV> is required");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");
  return { file, execute, actor };
}

async function main() {
  const { file, execute, actor } = parseArgs(process.argv.slice(2));

  const rawRows = await parseHubSpotCsv(file, REQUIRED_HEADERS);
  const hubspotCompanies = rawRows.map(mapHubSpotCompanyRow);
  const fieldRows = rawRows.map(mapCompanyFieldsBackfillRow);

  const existingCompanies = await readExistingCompanies();
  // Empty maps: this backfill never creates a company or a note, only
  // fills fields on ones planCompanyResolution matches to an existing row.
  const resolution = planCompanyResolution(hubspotCompanies, existingCompanies, new Map(), new Set());

  const bds = await db.select({ id: bd.id, name: bd.name }).from(bd);

  const resolvedRows: CompanyFieldsBackfillRow[] = [];
  let unresolved = 0;
  for (const row of fieldRows) {
    const res = resolution.byHubspotCompanyId.get(row.hubspotCompanyId);
    if (!res || !res.companyKey) {
      unresolved++;
      continue;
    }
    const ownerMatch = row.ownerRaw ? matchHubSpotOwner(row.ownerRaw, bds) : { bdId: null, unknownOwnerName: null };
    resolvedRows.push({
      hubspotCompanyId: row.hubspotCompanyId,
      companyKey: res.companyKey,
      industry: row.industry,
      city: row.city,
      country: row.country,
      ownerBdId: ownerMatch.bdId,
    });
  }

  const existingByKey = await readExistingCompanyFields([...new Set(resolvedRows.map((r) => r.companyKey))]);
  const plan = planCompanyFieldsBackfill(resolvedRows, existingByKey);

  console.log(`Rows in file: ${rawRows.length}`);
  console.log(`Resolved to an existing company: ${resolvedRows.length}`);
  console.log(`Unresolved (no existing company match): ${unresolved}`);
  console.log(`Companies matched (distinct): ${plan.matched}`);
  console.log(`Companies with no new data to fill: ${plan.skippedNoNewData}`);
  console.log(`Would update: ${plan.updates.length}`);
  console.log(`  industry filled: ${plan.fieldCounts.industry}`);
  console.log(`  city filled: ${plan.fieldCounts.city}`);
  console.log(`  country filled: ${plan.fieldCounts.country}`);
  console.log(`  owner filled: ${plan.fieldCounts.ownerBdId}`);

  if (!execute) {
    console.log("Dry run only — nothing written. Re-run with --execute --actor=<bd id>.");
    return;
  }
  if (!plan.updates.length) {
    console.log("Nothing to update.");
    return;
  }

  const values = plan.updates.map(
    (u) =>
      sql`(${u.companyKey}::text, ${u.industry ?? null}::text, ${u.city ?? null}::text, ${u.country ?? null}::text, ${u.ownerBdId ?? null}::uuid)`,
  );

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE company AS c
      SET industry = coalesce(c.industry, v.industry),
          city = coalesce(c.city, v.city),
          country = coalesce(c.country, v.country),
          owner_bd_id = coalesce(c.owner_bd_id, v.owner_bd_id)
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(company_key, industry, city, country, owner_bd_id)
      WHERE c.company_key = v.company_key
    `);
    await tx.insert(auditLog).values({
      actorBdId: actor!,
      action: "migration_backfill_hubspot_company_fields",
      metadata: {
        rowsInFile: rawRows.length,
        resolved: resolvedRows.length,
        unresolved,
        companiesMatched: plan.matched,
        noNewData: plan.skippedNoNewData,
        updated: plan.updates.length,
        fieldCounts: plan.fieldCounts,
        // Revert keys: the exact companies touched, for a manual revert
        // query — never printed to the console.
        companyKeys: plan.updates.map((u) => u.companyKey),
      },
    });
  });

  console.log(`Updated ${plan.updates.length} companies.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
