/**
 * One-off, owner-gated load of 50 verified LinkedIn company pages into
 * `company.linkedin_url` (list + planner: src/lib/companies/linkedinBulkLoad.ts).
 *
 * Rules:
 *   - Never overwrites: only rows where `linkedin_url IS NULL`, re-checked in
 *     the UPDATE's WHERE at write time (a row filled since the read is
 *     skipped and reported as a race).
 *   - Matches by exact `display_name`. Zero or several rows -> skipped.
 *   - Values go through normalizeCompanyLinkedinUrl; a rejection is skipped.
 *   - Audit trail mirrors the 18 values already loaded: one
 *     `company_property_history` row per company (property 'linkedinUrl',
 *     old_value NULL, source 'import', `at` = now). `changed_by_bd_id` is
 *     taken from the EXISTING source='import' linkedinUrl rows (read-only,
 *     printed in the dry run); if they disagree the script stops. The
 *     `company` row gets `linkedin_url` and `updated_at` only.
 *   - One `audit_log` row (action `company_linkedin_bulk_load`, actor from
 *     --actor) in the same transaction, listing every company_key written.
 *   - All or nothing: UPDATE + history + audit in ONE transaction, one
 *     set-based statement each (50 rows, a single batch).
 *
 * Revert (company keys are in the audit_log metadata):
 *   update company set linkedin_url = null
 *     where company_key in (<keys>) and linkedin_url = <value written>;
 *   delete from company_property_history
 *     where property = 'linkedinUrl' and source = 'import' and old_value is null
 *       and company_key in (<keys>) and at >= <audit_log.at> - interval '1 minute';
 *
 * Defaults to dry run (no writes). `--execute --actor=<bd uuid>` writes.
 * Prints counts and company names only — no contact data.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/load-company-linkedin-urls.ts
 *   npx tsx --env-file=.env.local scripts/load-company-linkedin-urls.ts --execute --actor=<bd id>
 */
import { inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, company } from "../src/db/schema";
import {
  LINKEDIN_BULK_LOAD_PAIRS,
  planLinkedinBulkLoad,
  type LinkedinBulkLoadMatch,
} from "../src/lib/companies/linkedinBulkLoad";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv: readonly string[]) {
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --dry-run, --actor=<bd id>`);
  }
  if (execute && (!actor || !UUID.test(actor))) throw new Error("--execute requires --actor=<bd uuid>");
  return { execute, actor };
}

interface Counts {
  withLinkedin: number;
  historyRows: number;
}

async function readCounts(): Promise<Counts> {
  const rows = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM company WHERE linkedin_url IS NOT NULL)::int AS with_linkedin,
      (SELECT count(*) FROM company_property_history WHERE property = 'linkedinUrl')::int AS history_rows
  `)) as unknown as { with_linkedin: number | string; history_rows: number | string }[];
  return { withLinkedin: Number(rows[0]!.with_linkedin), historyRows: Number(rows[0]!.history_rows) };
}

/** The shape of the rows already written by the earlier import. */
async function readExistingImportShape() {
  const rows = (await db.execute(sql`
    SELECT changed_by_bd_id::text AS changed_by, old_value, count(*)::int AS n,
           min(at)::text AS first_at, max(at)::text AS last_at
    FROM company_property_history
    WHERE property = 'linkedinUrl' AND source = 'import'
    GROUP BY changed_by_bd_id, old_value
  `)) as unknown as {
    changed_by: string | null;
    old_value: string | null;
    n: number | string;
    first_at: string;
    last_at: string;
  }[];
  return rows.map((r) => ({ ...r, n: Number(r.n) }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const shape = await readExistingImportShape();
  console.log("Existing company_property_history rows (property=linkedinUrl, source=import), grouped:");
  if (!shape.length) console.log("  (none)");
  for (const s of shape) {
    console.log(`  n=${s.n} changed_by=${s.changed_by ?? "NULL"} old_value=${s.old_value ?? "NULL"} at ${s.first_at} .. ${s.last_at}`);
  }
  if (shape.length > 1) {
    throw new Error("Existing import rows have more than one shape; refusing to guess. Inspect and extend the script.");
  }
  const historyActor = shape[0]?.changed_by ?? null;
  console.log(`New history rows will use changed_by_bd_id=${historyActor ?? "NULL"}, source=import, old_value=NULL, at=now()`);

  const before = await readCounts();
  console.log(`BEFORE: company.linkedin_url IS NOT NULL = ${before.withLinkedin}; linkedinUrl history rows = ${before.historyRows}`);

  const names = LINKEDIN_BULK_LOAD_PAIRS.map((p) => p.displayName);
  const rows = await db
    .select({ companyKey: company.companyKey, displayName: company.displayName, linkedinUrl: company.linkedinUrl })
    .from(company)
    .where(inArray(company.displayName, names));
  const byName = new Map<string, LinkedinBulkLoadMatch[]>();
  for (const r of rows) {
    const list = byName.get(r.displayName) ?? [];
    list.push({ companyKey: r.companyKey, linkedinUrl: r.linkedinUrl });
    byName.set(r.displayName, list);
  }

  const plan = planLinkedinBulkLoad(LINKEDIN_BULK_LOAD_PAIRS, byName);
  console.log("");
  console.log(`Would write ${plan.writes.length} of ${LINKEDIN_BULK_LOAD_PAIRS.length}:`);
  for (const w of plan.writes) console.log(`  ${w.companyKey} | ${w.displayName} -> ${w.linkedinUrl}`);
  console.log(`Skipped ${plan.skips.length}:`);
  for (const s of plan.skips) {
    const n = byName.get(s.displayName)?.length ?? 0;
    console.log(`  ${s.displayName} | ${s.reason}${s.reason === "multiple_matches" ? ` (${n} rows)` : ""}`);
  }

  if (!args.execute) {
    console.log("\nDry run only - no writes performed. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  if (!plan.writes.length) {
    console.log("\nNothing to write.");
    return;
  }

  const applied = await db.transaction(async (tx) => {
    const values = plan.writes.map((w) => sql`(${w.companyKey}::text, ${w.linkedinUrl}::text)`);
    const updated = (await tx.execute(sql`
      UPDATE company AS c
      SET linkedin_url = v.url, updated_at = now()
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(company_key, url)
      WHERE c.company_key = v.company_key AND c.linkedin_url IS NULL
      RETURNING c.company_key, v.url
    `)) as unknown as { company_key: string; url: string }[];
    if (!updated.length) return updated;

    const hist = updated.map(
      (u) => sql`(${u.company_key}::text, 'linkedinUrl', NULL, ${u.url}::text, ${historyActor}::uuid, 'import')`,
    );
    await tx.execute(sql`
      INSERT INTO company_property_history (company_key, property, old_value, new_value, changed_by_bd_id, source)
      VALUES ${sql.join(hist, sql`, `)}
    `);
    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: "company_linkedin_bulk_load",
      metadata: {
        written: updated.length,
        skippedRace: plan.writes.length - updated.length,
        skips: plan.skips,
        written_rows: updated.map((u) => ({ companyKey: u.company_key, linkedinUrl: u.url })),
      },
    });
    return updated;
  });

  console.log(`\nApplied ${applied.length}/${plan.writes.length}${applied.length !== plan.writes.length ? ` (${plan.writes.length - applied.length} skipped - race)` : ""}`);
  const after = await readCounts();
  console.log(`AFTER: company.linkedin_url IS NOT NULL = ${after.withLinkedin}; linkedinUrl history rows = ${after.historyRows}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
