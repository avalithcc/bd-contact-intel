// Read-only: how healthy is the free-text person.country today, judged by the SAME resolver the
// audience uses (resolveCountry). An unrecognised value produces a HOLD instead of a draft, so
// every unresolved spelling is a contact that cannot be written to.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { resolveCountry } from "@/lib/sequences/complianceAudience";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const rows = (await db.execute(sql`
    select country, count(*)::int as n
    from person where merged_into_id is null and country is not null and country <> ''
    group by country order by n desc
  `)) as unknown as Array<{ country: string; n: number }>;

  const bad = rows.filter((r) => resolveCountry(r.country) === null);
  const contacts = rows.reduce((s, r) => s + r.n, 0);
  const badContacts = bad.reduce((s, r) => s + r.n, 0);

  console.log(`distinct country spellings: ${rows.length}, contacts with a country: ${contacts}`);
  console.log(`spellings the resolver does NOT recognise: ${bad.length} (${badContacts} contacts)`);
  console.log("\ntop 12 values in use:");
  for (const r of rows.slice(0, 12)) {
    console.log(`  ${String(r.n).padStart(5)}  ${resolveCountry(r.country) ?? "??"}  ${r.country}`);
  }
  if (bad.length) {
    console.log("\nunrecognised (these HOLD instead of drafting):");
    for (const r of bad.slice(0, 20)) console.log(`  ${String(r.n).padStart(5)}  ${JSON.stringify(r.country)}`);
  }
  process.exit(0);
}
void main();
