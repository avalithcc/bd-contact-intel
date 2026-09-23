/**
 * CLI equivalent of the /leads page's upload control (see
 * src/app/leads/UploadLeadsForm.tsx and src/app/leads/actions.ts), for
 * repeatable imports straight from the lead_gen data directory without
 * going through the browser.
 *
 * Parses whichever of the known files exist in the given directory (see
 * src/lib/leads/csv.ts for the merge/precedence logic across them), then
 * delegates to the same `importLeads` used by the app — same chunking, same
 * upsert-by-(source_key, attendee_id) idempotency. Safe to re-run on the
 * same directory or a refreshed export.
 *
 * Deliberately does NOT read `.hunter_key` (an API credential for
 * generating the hunter file, not lead data) and never copies any CSV into
 * this repo — it only reads them from the given path at run time.
 *
 * Usage (do NOT run automatically — this touches the real database):
 *   npx tsx scripts/import-leads.ts <sourceKey> <path-to-lead_gen/data> [displayName]
 *
 * Example:
 *   npx tsx scripts/import-leads.ts fi-arg-2026 ../lead_gen/data "FI ARG 2026"
 *
 * Requires DATABASE_URL to be set (see .env), pointed at the production
 * database when that's the intent — this script has no environment guard
 * of its own.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLeadDrafts, type LeadCsvBundle } from "../src/lib/leads/csv";
import { importLeads } from "../src/lib/leads/queries";

const KNOWN_FILES: Record<keyof LeadCsvBundle, string> = {
  attendees: "fi-arg-2026-attendees.csv",
  decisores: "fi-arg-2026-decisores-bancos-fintech.csv",
  hunter: "fi-arg-2026-mails-hunter.csv",
  probables: "fi-arg-2026-mails-probables.csv",
  correosFinal: "correos_final.csv",
  columnaCorreos: "columna_correos.tsv",
};

function readIfExists(dir: string, filename: string): string | undefined {
  const path = join(dir, filename);
  return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

async function main() {
  const [sourceKey, dataDir, displayNameArg] = process.argv.slice(2);
  if (!sourceKey || !dataDir) {
    console.error(
      "Usage: npx tsx scripts/import-leads.ts <sourceKey> <path-to-lead_gen/data> [displayName]",
    );
    process.exit(1);
  }
  const displayName = displayNameArg ?? sourceKey;

  const bundle: LeadCsvBundle = {};
  for (const [key, filename] of Object.entries(KNOWN_FILES) as [keyof LeadCsvBundle, string][]) {
    const content = readIfExists(dataDir, filename);
    if (content) {
      bundle[key] = content;
      console.log(`Found ${filename}`);
    }
  }
  if (!Object.values(bundle).some(Boolean)) {
    console.error(`No known lead files found in ${dataDir}. Expected one of: ${Object.values(KNOWN_FILES).join(", ")}`);
    process.exit(1);
  }

  const drafts = buildLeadDrafts(bundle);
  console.log(`Merged ${drafts.length} distinct attendees from the provided files.`);

  const result = await importLeads(sourceKey, displayName, drafts);
  console.log(`Upserted ${result.upserted} leads into source "${sourceKey}".`);
  if (result.matchedOwners.length) {
    console.log(`Matched owners: ${result.matchedOwners.join(", ")}`);
  }
  if (result.unmatchedOwners.length) {
    console.warn(
      `\n[WARNING] Could not match these owner names to a BD, left unassigned: ${result.unmatchedOwners.join(", ")}\n`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
