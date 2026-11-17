// Read-only: does the candidate query now hand back companies that have NEVER been probed?
// Before the ORDER BY fix a 200-company run added 2 rows to company_probe: it was re-checking
// companies first probed two months ago, because PROBE_COOLDOWN_DAYS is 30 and they are the dense ones.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCandidateCompanies } from "@/lib/hiring/discovery";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const candidates = await getCandidateCompanies(100);
  const keys = candidates.map((c) => c.companyKey);
  const probed = (await db.execute(sql`
    select company_key, last_probed_at from company_probe
    where company_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
  `)) as unknown as Array<{ company_key: string }>;
  const probedSet = new Set(probed.map((p) => p.company_key));
  const fresh = candidates.filter((c) => !probedSet.has(c.companyKey));
  console.log(`next 100 candidates: ${fresh.length} never probed, ${candidates.length - fresh.length} re-probes`);
  console.log("first five:");
  for (const c of candidates.slice(0, 5)) {
    console.log(`  ${c.displayName.slice(0, 32).padEnd(34)} contacts=${String(c.contactCount).padStart(3)}  neverProbed=${!probedSet.has(c.companyKey)}`);
  }
  process.exit(0);
}
void main();
