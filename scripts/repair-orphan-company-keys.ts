/**
 * One-off repair for contacts whose `company_key` points at no `company` row.
 *
 * CAUSE: the fi-arg-2026 and contactos-comerciales-2026-10 importers wrote
 * `person.company_key` from the company text without creating the matching
 * `company` row. Those contacts are NOT broken for a BD — `person.company`
 * still holds the text, so the record reads normally — but they belong to no
 * company, so they are missing from every company-side count and view.
 *
 * This script handles only the two unambiguous groups and deliberately leaves
 * the third alone:
 *
 *   REPAIR — the company already exists under a different spelling
 *            ("bunkerdb" vs "bunker db", "naranjax" vs "naranja x"). Matched
 *            by squashing both keys to [a-z0-9], the same normalization
 *            scripts/merge-companies.ts uses. Repointed to the canonical key.
 *   DETACH — the key is not a company at all ("-", "(sin dato)", empty).
 *            The contact keeps its own text; only the key is cleared.
 *   LEFT ALONE — a real company that has no `company` row. Creating those is
 *            a product decision (it would add hundreds of bare rows to a
 *            table where most companies already carry no client status), so
 *            this script never creates a company.
 *
 * Every write goes through `changeContactCompany`, the same path the record
 * page's company picker uses, so each contact gets its `person_property_history`
 * rows for `company` and `companyKey` attributed to the actor. No new write
 * path, no raw UPDATE.
 *
 * Usage (dry run by default — never writes):
 *   npx tsx --env-file=.env.local scripts/repair-orphan-company-keys.ts
 *   npx tsx --env-file=.env.local scripts/repair-orphan-company-keys.ts --execute --actor=<bd id>
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { changeContactCompany } from "../src/lib/contacts/companyChangeDb";
import { isUuid } from "../src/lib/uuid";

/** Latin-only, used ONLY to match a key against an existing company. A
 * non-Latin key simply fails to match and falls into the "left alone"
 * bucket, which is the safe one. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const JUNK = new Set(["", "-", "sindato", "na", "none", "null", "."]);

/**
 * BUG THIS GUARDS AGAINST (hit on the first run, 2026-10-08): the junk test
 * used to be `squash(key).length < 2`, and `squash` strips everything outside
 * [a-z0-9]. A Cyrillic or Arabic company name squashes to the empty string,
 * so "АО «Системы управления»" and "مؤسسه تراتيل" were classified as junk and
 * detached, wiping real employer text. Count letters and digits in ANY
 * script instead, so the test never depends on the alphabet.
 */
const meaningfulChars = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
const isJunkKey = (key: string) => JUNK.has(squash(key)) || meaningfulChars(key) < 2;

function parseArgs(argv: readonly string[]) {
  let execute = false;
  let actor: string | null = null;
  for (const a of argv) {
    if (a === "--execute") execute = true;
    else if (a.startsWith("--actor=")) actor = a.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${a}. Valid: --execute, --actor=<bd id>`);
  }
  if (execute && (!actor || !isUuid(actor))) throw new Error("--execute requires --actor=<bd uuid> for the history rows.");
  return { execute, actor };
}

async function main() {
  const { execute, actor } = parseArgs(process.argv.slice(2));

  const orphans = (await db.execute(sql`
    select p.id::text as id, p.company_key as key from person p
    where p.merged_into_id is null and p.company_key is not null
      and not exists (select 1 from company c where c.company_key = p.company_key)
    order by p.company_key, p.id`)) as unknown as { id: string; key: string }[];

  const companies = (await db.execute(sql`select company_key as key from company`)) as unknown as { key: string }[];
  const canonical = new Map<string, string>();
  for (const c of companies) {
    const s = squash(c.key);
    if (s && !canonical.has(s)) canonical.set(s, c.key);
  }

  const repair: { id: string; from: string; to: string }[] = [];
  const detach: { id: string; from: string }[] = [];
  let leftAlone = 0;
  for (const o of orphans) {
    if (isJunkKey(o.key)) { detach.push({ id: o.id, from: o.key }); continue; }
    const hit = canonical.get(squash(o.key));
    if (hit) repair.push({ id: o.id, from: o.key, to: hit });
    else leftAlone++;
  }

  console.log(`Orphaned contacts: ${orphans.length}`);
  console.log(`  repoint to an existing company: ${repair.length}`);
  console.log(`  detach (key is not a company):  ${detach.length}`);
  console.log(`  left alone (company does not exist): ${leftAlone}`);
  const pairs = [...new Set(repair.map((r) => `${r.from} -> ${r.to}`))];
  if (pairs.length) console.log(`\nRepoints:\n${pairs.map((p) => `  ${p}`).join("\n")}`);
  const keys = [...new Set(detach.map((d) => d.from))];
  if (keys.length) console.log(`\nDetached keys: ${keys.map((k) => JSON.stringify(k)).join(", ")}`);

  if (!execute) {
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  let done = 0;
  for (const r of repair) { await changeContactCompany(r.id, r.to, actor!); done++; }
  for (const d of detach) { await changeContactCompany(d.id, null, actor!); done++; }
  console.log(`\nApplied to ${done} contact(s).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
