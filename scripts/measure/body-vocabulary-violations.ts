// Read-only, counts only: how many drafts on LIVE members (drafted, approved, sent) the approval gate would refuse for
// banned vendor vocabulary in the body, split by step. Uses the SAME check approval runs (checkBodyVocabulary), so the
// number is what a BD would hit, not a re-implementation. Run before regenerating anything.
//   npx tsx --env-file=.env scripts/measure/body-vocabulary-violations.ts
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { checkBodyVocabulary, parseBannedVocabularyReason } from "@/lib/sequences/approvalChecks";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const rows = (await db.execute(sql`
    select d.step, m.state, d.body, (d.approved_at is not null) as approved
    from sequence_draft d join sequence_member m on m.id = d.sequence_member_id
    where m.state in ('drafted', 'approved', 'sent') and d.body is not null
  `)) as unknown as Array<{ step: number; state: string; body: string; approved: boolean }>;

  const total = new Map<string, number>();
  const refused = new Map<string, number>();
  const byTerm = new Map<string, number>();
  for (const r of rows) {
    const k = `step ${r.step} / ${r.state} / ${r.approved ? "approved" : "not approved"}`;
    total.set(k, (total.get(k) ?? 0) + 1);
    const c = checkBodyVocabulary(r.body, COMPLIANCE_CONFIG);
    if (c.ok) continue;
    refused.set(k, (refused.get(k) ?? 0) + 1);
    for (const t of (parseBannedVocabularyReason(c.reason) ?? "").split(", ")) byTerm.set(t, (byTerm.get(t) ?? 0) + 1);
  }
  const sum = (m: Map<string, number>, step: number) => [...m].filter(([k]) => k.startsWith(`step ${step} `)).reduce((a, [, n]) => a + n, 0);
  console.log(`live drafts: ${rows.length}, refused: ${[...refused.values()].reduce((a, b) => a + b, 0)}`);
  for (const step of [1, 2]) console.log(`step ${step}: ${sum(refused, step)} refused of ${sum(total, step)}`);
  console.log("\nby step / member state / approval (refused of total):");
  for (const [k, n] of [...total].sort()) console.log(`  ${k}: ${refused.get(k) ?? 0} of ${n}`);
  console.log("\nby term:");
  for (const [t, n] of [...byTerm].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${t}`);
  process.exit(0);
}
void main();
