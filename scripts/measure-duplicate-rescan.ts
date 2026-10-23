/**
 * READ-ONLY measurement: what a duplicates RE-SCAN would find today, and what it would still miss.
 *
 * Why it exists. Detection of duplicate contacts is write-time only: a candidate row is created when a contact is
 * written, never afterwards. The admin screen therefore reads "0 abiertos" not because the data is clean but because
 * nobody is looking. This measures (a) how many live collisions the matcher's OWN key would find now, (b) how many of
 * them were ever flagged, and (c) how many MORE would be found if company keys were resolved through company_alias
 * first — the gap that makes two "Roberto Gorchs" at `andina tech` and `andina` invisible to a key-only re-scan.
 *
 * It uses the app's real buildNameCompanyKey, so the counts are what the app would produce, not a re-implementation.
 *
 * Nothing is written. The transaction is explicitly READ ONLY and that is asserted before and after the reads.
 *
 * Usage (reads the real database; SELECT only):
 *   npx tsx --env-file=.env scripts/measure-duplicate-rescan.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { buildNameCompanyKey } from "../src/lib/identity/matcher";

type P = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
  canonKey: string | null;
  ownerName: string | null;
  activities: number;
  lastActivity: string | null;
  email: string | null;
};

const group = <T>(rows: T[], key: (r: T) => string | null) => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return [...m.entries()].filter(([, v]) => v.length > 1);
};

async function main() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const ro: any[] = await tx.execute(sql`show transaction_read_only`);
    console.log(`read_only=${JSON.stringify(ro[0])}`);

    const cols: any[] = await tx.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'duplicate_candidate' order by ordinal_position
    `);
    console.log(`\nduplicate_candidate columns: ${cols.map((c) => c.column_name).join(", ")}`);

    const state: any[] = await tx.execute(sql`
      select coalesce(status, '(null)') as "state", count(*)::int as n,
             max(created_at)::text as "newest"
      from duplicate_candidate group by 1 order by n desc
    `);
    console.log(`\ncandidate rows by resolution:`);
    for (const s of state) console.log(`  ${s.state}: ${s.n}  (newest created ${s.newest})`);

    const people: P[] = await tx.execute(sql`
      select p.id::text as "id", p.first_name as "firstName", p.last_name as "lastName",
             p.company as "company", p.company_key as "companyKey",
             coalesce(ca.company_key, p.company_key) as "canonKey",
             b.name as "ownerName",
             (select count(*)::int from activity a where a.person_id = p.id and a.deleted_at is null) as "activities",
             (select max(a.created_at)::text from activity a where a.person_id = p.id and a.deleted_at is null) as "lastActivity",
             nullif(btrim(p.email), '') as "email"
      from person p
      left join company_alias ca on ca.alias_key = p.company_key
      left join bd b on b.id = p.owner_bd_id
      where p.merged_into_id is null
    `);
    console.log(`\nlive persons: ${people.length}`);

    const pairs: any[] = await tx.execute(sql`
      select person_a_id::text as a, person_b_id::text as b from duplicate_candidate
    `);
    const flagged = new Set(pairs.flatMap((r) => [`${r.a}|${r.b}`, `${r.b}|${r.a}`]));
    const everFlagged = (g: P[]) => g.some((x, i) => g.slice(i + 1).some((y) => flagged.has(`${x.id}|${y.id}`)));

    const byKey = group(people, (p) => buildNameCompanyKey(p));
    const byCanon = group(people, (p) => buildNameCompanyKey({ ...p, companyKey: p.canonKey }));

    const report = (label: string, groups: [string, P[]][]) => {
      const unflagged = groups.filter(([, g]) => !everFlagged(g));
      console.log(`\n${label}`);
      console.log(`  colliding groups: ${groups.length}, people: ${groups.reduce((n, [, g]) => n + g.length, 0)}`);
      console.log(`  ever flagged: ${groups.length - unflagged.length}, NEVER flagged: ${unflagged.length}`);
      return unflagged;
    };

    report("A) matcher's key as-is (company_key, no alias step):", byKey);
    const unflaggedCanon = report("B) same key, company resolved through company_alias first:", byCanon);
    console.log(`\n  extra groups that ONLY the alias step finds: ${byCanon.length - byKey.length}`);

    console.log(`\n--- never-flagged groups where MORE THAN ONE BD has activity (the real cost) ---`);
    let contested = 0;
    for (const [key, g] of unflaggedCanon) {
      const owners = new Set(g.map((p) => p.ownerName).filter(Boolean));
      const active = g.filter((p) => p.activities > 0);
      if (owners.size <= 1 && active.length <= 1) continue;
      contested += 1;
      console.log(`  ${key}`);
      for (const p of g) {
        console.log(`    - ${p.firstName ?? ""} ${p.lastName ?? ""} | key=${p.companyKey} canon=${p.canonKey} | owner=${p.ownerName ?? "(none)"} | ${p.activities} activities | last=${p.lastActivity ?? "-"} | ${p.email ?? "(no email)"}`);
      }
    }
    console.log(`\ncontested groups (two owners or two with activity): ${contested}`);

    const after: any[] = await tx.execute(sql`show transaction_read_only`);
    console.log(`\nread_only_after=${JSON.stringify(after[0])}`);
    console.log(`measured_at (UTC): ${new Date().toISOString()}`);
  });
  process.exit(0);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
