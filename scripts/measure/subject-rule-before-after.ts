// Read-only: did enforcing the subject rule actually change what ships?
// Splits live subjects at the moment PR #447 deployed (2026-11-16T19:37:48Z) and
// judges both halves with the SAME validator the generator now enforces.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { validateSubject } from "@/lib/outreach/subjectRules";

const LIVE = new Date("2026-11-16T19:37:48Z");

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const rows = (await db.execute(sql`
    select subject, generated_at from sequence_draft where subject is not null order by generated_at
  `)) as unknown as Array<{ subject: string; generated_at: Date }>;

  for (const [label, set] of [
    ["BEFORE the rule was enforced", rows.filter((r) => new Date(r.generated_at) < LIVE)],
    ["AFTER ", rows.filter((r) => new Date(r.generated_at) >= LIVE)],
  ] as const) {
    const bad = set.filter((r) => validateSubject(r.subject).length > 0);
    const pct = set.length ? ((bad.length / set.length) * 100).toFixed(1) : "n/a";
    console.log(`${label}: ${set.length} subjects, ${bad.length} break the rule (${pct}%)`);
  }

  const after = rows.filter((r) => new Date(r.generated_at) >= LIVE);
  console.log("\nsubjects generated since the rule went live:");
  for (const r of after) {
    const v = validateSubject(r.subject);
    console.log(`  ${v.length ? "BREAKS" : "ok    "} [${r.subject.length}] ${r.subject}`);
  }
  process.exit(0);
}
void main();
