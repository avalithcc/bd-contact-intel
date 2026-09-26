/**
 * Fill-empty backfill of `person.phone`/`person.mobile_phone` from a
 * HubSpot contacts export (phone-calls change, Step 2.7). Maps "Número de
 * teléfono" -> phone, "Número de móvil" -> mobile_phone (owner mapping),
 * matching persons through `person_id_map` (`legacy_table = 'hubspot_contact'`,
 * `legacy_id = hubspotLegacyId(hubspotContactId)` — the SAME deterministic
 * uuid v5 derivation the main HubSpot import already uses:
 * src/lib/hubspot/uuidv5.ts). Never overwrites a column that already has a
 * value (fill-empty only) — see src/lib/hubspot/phoneBackfill.ts for the
 * pure, unit-tested planner this script calls before writing anything.
 *
 * Defaults to a DRY RUN that only prints counts (matched / to-update /
 * unmatched / no-new-data) — never row-level data, since the CSV is PII.
 * Pass --execute with --actor=<bd id> to write, in ONE transaction plus
 * ONE audit_log row (mirrors scripts/backfill-connection-signals.ts).
 *
 * Usage (do NOT run automatically — this reads the real CSV path and, on
 * --execute, writes the real database):
 *   npx tsx --env-file=.env.local scripts/backfill-hubspot-phones.ts --file=hubspot/todos-contactos.csv
 *   npx tsx --env-file=.env.local scripts/backfill-hubspot-phones.ts --file=hubspot/todos-contactos.csv --execute --actor=<bd id>
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, person, personIdMap } from "../src/db/schema";
import { parseHubSpotCsv } from "../src/lib/hubspot/parse";
import {
  mapPhoneBackfillRow,
  planPhoneBackfill,
  type ExistingPersonPhoneRow,
} from "../src/lib/hubspot/phoneBackfill";
import { hubspotLegacyId } from "../src/lib/hubspot/uuidv5";

const REQUIRED_HEADERS = ["ID de registro", "Número de teléfono", "Número de móvil"] as const;

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
  if (!file) throw new Error("--file=<path to HubSpot contacts CSV> is required");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");
  return { file, execute, actor };
}

/** Batched existing-state read: one query for every hubspotContactId
 * present in the CSV, never per-row (bounded — see data-builder query
 * rules). */
async function readExistingPhoneRows(
  hubspotContactIds: readonly string[],
): Promise<Map<string, ExistingPersonPhoneRow>> {
  const legacyIds = hubspotContactIds.map(hubspotLegacyId);
  const rows = await db
    .select({
      legacyId: personIdMap.legacyId,
      personId: person.id,
      phone: person.phone,
      mobilePhone: person.mobilePhone,
    })
    .from(personIdMap)
    .innerJoin(person, eq(person.id, personIdMap.personId))
    .where(and(eq(personIdMap.legacyTable, "hubspot_contact"), inArray(personIdMap.legacyId, legacyIds)));

  const result = new Map<string, ExistingPersonPhoneRow>();
  for (const row of rows) {
    result.set(row.legacyId, { personId: row.personId, phone: row.phone, mobilePhone: row.mobilePhone });
  }
  return result;
}

async function main() {
  const { file, execute, actor } = parseArgs(process.argv.slice(2));

  const rawRows = await parseHubSpotCsv(file, REQUIRED_HEADERS);
  const rows = rawRows.map(mapPhoneBackfillRow);
  const existing = await readExistingPhoneRows(rows.map((r) => r.hubspotContactId));
  const plan = planPhoneBackfill(rows, existing);

  console.log(`Rows in file: ${rows.length}`);
  console.log(`Matched to a person: ${plan.matched}`);
  console.log(`Unmatched (no person_id_map row): ${plan.skippedNoMatch}`);
  console.log(`Matched but no new data to fill: ${plan.skippedNoNewData}`);
  console.log(`Would update: ${plan.updates.length}`);

  if (!execute) {
    console.log("Dry run only — nothing written. Re-run with --execute --actor=<bd id>.");
    return;
  }
  if (!plan.updates.length) {
    console.log("Nothing to update.");
    return;
  }

  const values = plan.updates.map(
    (u) => sql`(${u.personId}::uuid, ${u.phone ?? null}::text, ${u.mobilePhone ?? null}::text)`,
  );

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE person AS p
      SET phone = coalesce(p.phone, v.phone),
          mobile_phone = coalesce(p.mobile_phone, v.mobile_phone)
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, phone, mobile_phone)
      WHERE p.id = v.id
    `);
    await tx.insert(auditLog).values({
      actorBdId: actor!,
      action: "migration_backfill_hubspot_phones",
      metadata: {
        rowsInFile: rows.length,
        matched: plan.matched,
        unmatched: plan.skippedNoMatch,
        noNewData: plan.skippedNoNewData,
        updated: plan.updates.length,
      },
    });
  });

  console.log(`Updated ${plan.updates.length} persons.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
