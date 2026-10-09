/**
 * Applies the owner's per-employer decisions about the "grey zone": contacts
 * whose employer exists as text on `person.company` but has no `company` row,
 * because the fi-arg-2026 and contactos-comerciales-2026-10 importers wrote
 * `person.company_key` without creating the company.
 *
 * INPUT: --json=<path>, an array of {"key","mark"} where `key` is the orphan
 * `company_key` and `mark` is one of:
 *
 *   "same"   -> that employer IS a company already in the CRM under another
 *               spelling. Contacts are REPOINTED to the canonical key.
 *   "create" -> a real company with no row. The row is CREATED with the orphan
 *               key as its primary key, so the contacts resolve with no update
 *               at all: company_key never changes, it simply starts matching.
 *   "skip"   -> left exactly as it is.
 *
 * The decisions come from a human reading the records, never from this script.
 * For "same" the TARGET is derived here the same way the review page derived
 * its suggestion (squash both keys to [a-z0-9], then prefix containment, see
 * src/lib/companyMerge/sameCompany.ts), and a key with no target, or with
 * several, is reported and left alone rather than guessed at — the
 * owner marked the employer, not the destination.
 *
 * Repoints go through `changeContactCompany`, the same path the record page's
 * company picker uses, so every moved contact gets its `person_property_history`
 * rows for `company` and `companyKey` attributed to the actor. Created companies
 * take their display name from the contacts' own `person.company` text.
 *
 * ONE audit_log row ('apply_grey_zone_decisions') holding both lists.
 * REVERT: delete metadata.createdCompanyKeys from `company` (the contacts go
 * back to being orphans), and for each entry in metadata.repointed set that
 * person's company_key/company back to `from`.
 *
 * Usage (dry run by default — never writes):
 *   npx tsx --env-file=.env.local scripts/apply-grey-zone-decisions.ts --json=<path>
 *   npx tsx --env-file=.env.local scripts/apply-grey-zone-decisions.ts --json=<path> --execute --actor=<bd id>
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, company } from "../src/db/schema";
import { buildCompanyKeyIndex, findSameCompany } from "../src/lib/companyMerge/sameCompany";
import { changeContactCompany } from "../src/lib/contacts/companyChangeDb";
import { isUuid } from "../src/lib/uuid";

export const GREY_ZONE_AUDIT_ACTION = "apply_grey_zone_decisions";

function parseArgs(argv: readonly string[]) {
  let json: string | null = null, execute = false, actor: string | null = null;
  for (const a of argv) {
    if (a === "--execute") execute = true;
    else if (a.startsWith("--actor=")) actor = a.slice("--actor=".length);
    else if (a.startsWith("--json=")) json = a.slice("--json=".length);
    else throw new Error(`Unknown argument: ${a}. Valid: --json=<path>, --execute, --actor=<bd id>`);
  }
  if (!json) throw new Error("Usage: --json=<path> [--execute --actor=<bd id>]");
  if (execute && (!actor || !isUuid(actor))) throw new Error("--execute requires --actor=<bd uuid>.");
  return { json, execute, actor };
}

async function main() {
  const { json, execute, actor } = parseArgs(process.argv.slice(2));
  const marks = JSON.parse(readFileSync(json, "utf-8")) as { key: string; mark: string }[];
  if (!Array.isArray(marks) || !marks.length) throw new Error("The json must be a non-empty array of {key, mark}.");

  const orphans = (await db.execute(sql`
    select p.company_key as k, max(p.company) as emp, count(*)::int as n,
      array_agg(p.id::text) as ids
    from person p
    where p.merged_into_id is null and p.company_key is not null
      and not exists (select 1 from company c where c.company_key = p.company_key)
    group by p.company_key`)) as unknown as { k: string; emp: string | null; n: number; ids: string[] }[];
  const byKey = new Map(orphans.map((o) => [o.k, o]));

  const companies = (await db.execute(sql`select company_key as k from company order by company_key`)) as unknown as { k: string }[];
  const index = buildCompanyKeyIndex(companies.map((c) => c.k));

  const repoint: { id: string; from: string; to: string }[] = [];
  const toCreate: { key: string; name: string; contacts: number }[] = [];
  const noTarget: string[] = [], ambiguous: string[] = [], gone: string[] = [];

  for (const m of marks) {
    const o = byKey.get(m.key);
    if (!o) { gone.push(m.key); continue; }           // already resolved or deleted since the review
    if (m.mark === "skip") continue;
    if (m.mark === "same") {
      const hit = findSameCompany(m.key, index, { prefix: true });
      if (hit.kind === "ambiguous") { ambiguous.push(`${m.key} -> ${hit.candidates.join(" | ")}`); continue; }
      if (hit.kind === "none") { noTarget.push(m.key); continue; }
      for (const id of o.ids) repoint.push({ id, from: m.key, to: hit.to });
    } else if (m.mark === "create") {
      toCreate.push({ key: m.key, name: (o.emp ?? m.key).trim(), contacts: o.n });
    }
  }

  console.log(`Decisions read: ${marks.length}`);
  console.log(`  repoint: ${repoint.length} contact(s) across ${new Set(repoint.map((r) => r.from)).size} employer(s)`);
  console.log(`  create:  ${toCreate.length} company/companies covering ${toCreate.reduce((n, c) => n + c.contacts, 0)} contact(s)`);
  if (noTarget.length) console.log(`  marked "same" but no target found, left alone: ${noTarget.join(" | ")}`);
  if (ambiguous.length) console.log(`  marked "same" but several companies fit, left alone: ${ambiguous.join(" ;; ")}`);
  if (gone.length) console.log(`  no longer in the grey zone, skipped: ${gone.length}`);

  if (!execute) { console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply."); return; }

  let created = 0;
  for (const c of toCreate) {
    const r = await db.insert(company).values({ companyKey: c.key, displayName: c.name, createdByBdId: actor!, updatedByBdId: actor! }).onConflictDoNothing().returning({ k: company.companyKey });
    created += r.length;
  }
  let moved = 0;
  for (const r of repoint) { await changeContactCompany(r.id, r.to, actor!); moved++; }

  const [row] = await db.insert(auditLog).values({
    actorBdId: actor!,
    action: GREY_ZONE_AUDIT_ACTION,
    metadata: { createdCompanyKeys: toCreate.map((c) => c.key), createdCount: created, repointed: repoint, noTarget, ambiguous },
  }).returning({ id: auditLog.id });
  console.log(`\nCreated ${created} company/companies, repointed ${moved} contact(s). audit_log id: ${row!.id}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
