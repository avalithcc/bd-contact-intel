/**
 * Fill-empty backfill of `person.job_title` + `person.role_group` from a
 * captured Lusha lookup file (persons whose role_group is "no_position").
 * All judgment lives in src/lib/lusha/titleBackfill.ts (six guards); this
 * script loads the snapshot, runs the planner, prints a report, and on
 * --execute applies the writes in ONE transaction with one audit_log row.
 *
 * The input must be a bare JSON array. DATABASE_URL lives in .env (there is no .env.local).
 * The input file is third-party contact data: keep it outside the repo.
 *
 * Dry run (default) opens no write transaction and prints what it WOULD write.
 *
 * Revert: every write leaves person_property_history rows with
 * source = 'lusha_title_backfill_2026-11-24'. Restore job_title/role_group
 * from old_value of the rows with that source (properties jobTitle, roleGroup).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-job-titles-from-lusha.ts --file=<json>
 *   npx tsx --env-file=.env scripts/backfill-job-titles-from-lusha.ts --file=<json> --execute --actor=<bd id>
 */
import { readFileSync } from "node:fs";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, person, personPropertyHistory } from "../src/db/schema";
import {
  LUSHA_TITLE_SOURCE,
  planLushaTitle,
  type LushaSkipReason,
  type LushaTitleCrm,
  type LushaTitlePlan,
  type LushaTitleRecord,
} from "../src/lib/lusha/titleBackfill";

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
  if (!file) throw new Error("--file=<path to Lusha JSON> is required");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");
  return { file, execute, actor };
}

const BATCH = 500;

async function main() {
  const { file, execute, actor } = parseArgs(process.argv.slice(2));
  const records = JSON.parse(readFileSync(file, "utf8")) as LushaTitleRecord[];
  if (!Array.isArray(records)) throw new Error("Input must be a JSON array");
  const emails = [...new Set(records.map((r) => r.email.trim().toLowerCase()))];

  const crmByEmail = new Map<string, LushaTitleCrm>();
  for (let i = 0; i < emails.length; i += BATCH) {
    const rows = await db
      .select({
        personId: person.id,
        email: person.emailNormalized,
        firstName: person.firstName,
        lastName: person.lastName,
        company: person.company,
        jobTitle: person.jobTitle,
        roleGroup: person.roleGroup,
      })
      .from(person)
      .where(and(inArray(person.emailNormalized, emails.slice(i, i + BATCH)), isNull(person.mergedIntoId)));
    for (const r of rows) if (r.email) crmByEmail.set(r.email, { ...r, email: r.email });
  }

  const skips = new Map<LushaSkipReason, string[]>();
  const writes: Array<Extract<LushaTitlePlan, { action: "write" }>> = [];
  const review: Array<{ email: string; reason: string; crm: string; lusha: string }> = [];
  for (const rec of records) {
    const email = rec.email.trim().toLowerCase();
    const crm = crmByEmail.get(email) ?? null;
    const plan = planLushaTitle(rec, crm);
    if (plan.action === "write") {
      writes.push(plan);
      continue;
    }
    skips.set(plan.reason, [...(skips.get(plan.reason) ?? []), email]);
    if (plan.reason.startsWith("needs_review") && !rec.notFound) {
      review.push({
        email,
        reason: plan.reason,
        crm: `${crm?.firstName ?? ""} ${crm?.lastName ?? ""} @ ${crm?.company ?? ""}`.trim(),
        lusha: `${rec.firstName ?? ""} ${rec.lastName ?? ""} | ${rec.title ?? ""} @ ${rec.companyName ?? ""} (${rec.companyDomain ?? ""})`,
      });
    }
  }

  const distribution = new Map<string, number>();
  for (const w of writes) distribution.set(w.roleGroup, (distribution.get(w.roleGroup) ?? 0) + 1);

  console.log(`Queried: ${records.length}`);
  console.log(`Not found at Lusha: ${skips.get("not_found_at_lusha")?.length ?? 0}`);
  console.log(`${execute ? "Will write" : "Would write"}: ${writes.length}`);
  console.log("Skipped by reason:");
  for (const [reason, list] of [...skips].sort()) console.log(`  ${reason}: ${list.length}`);
  console.log(`needs_review: ${review.length}`);
  for (const r of review) console.log(`  [${r.reason}] ${r.email}\n    CRM:   ${r.crm}\n    Lusha: ${r.lusha}`);
  console.log("Resulting role_group of the writes:");
  for (const [g, n] of [...distribution].sort((a, b) => b[1] - a[1])) console.log(`  ${g}: ${n}`);
  if (!execute) {
    for (const w of writes) console.log(`  WRITE ${w.personId} job_title=${JSON.stringify(w.jobTitle)} role_group=${w.roleGroup}`);
  }

  if (!execute) {
    console.log("Dry run only - nothing written. Re-run with --execute --actor=<bd id>.");
    return;
  }
  if (!writes.length) {
    console.log("Nothing to write.");
    return;
  }

  const values = writes.map((w) => sql`(${w.personId}::uuid, ${w.jobTitle}::text, ${w.roleGroup}::text)`);
  const history = writes.flatMap((w) => w.historyRows.map((h) => ({ ...h, changedByBdId: actor! })));
  const updated = await db.transaction(async (tx) => {
    // Re-asserts guard 1 in SQL so a concurrent edit is never overwritten.
    const res = await tx.execute(sql`
      UPDATE person AS p
      SET job_title = v.job_title, role_group = v.role_group, updated_at = now()
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, job_title, role_group)
      WHERE p.id = v.id AND p.role_group = 'no_position' AND (p.job_title IS NULL OR btrim(p.job_title) = '')
      RETURNING p.id::text AS id
    `);
    const touched = new Set((res as unknown as Array<{ id: string }>).map((r) => r.id));
    const rows = history.filter((h) => touched.has(h.personId));
    if (rows.length) await tx.insert(personPropertyHistory).values(rows);
    await tx.insert(auditLog).values({
      actorBdId: actor!,
      action: "migration_backfill_lusha_job_titles",
      metadata: { source: LUSHA_TITLE_SOURCE, queried: records.length, planned: writes.length, updated: touched.size },
    });
    return touched.size;
  });
  console.log(`Wrote ${updated} persons.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
