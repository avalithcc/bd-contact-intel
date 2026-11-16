// Read-only: what share of live sequence subjects break the subject rule, judged by the SAME validator the generator
// now enforces (src/lib/outreach/subjectRules.ts).
//
// This exists because the previous attempt to fix vendor-vocabulary subjects shipped with no way to tell whether it
// had worked. It had not: the rule sat in the prompt for weeks while roughly 4 in 10 live subjects broke it, and that
// only surfaced when the owner read his own outbox. Run this before and after a prompt change.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { validateSubject, type SubjectViolation } from "@/lib/outreach/subjectRules";

function label(v: SubjectViolation): string {
  switch (v.kind) {
    case "banned_phrase":
      return `banned_phrase:${v.term}`;
    case "banned_word_pair":
      return `banned_word_pair:${v.terms.join("+")}`;
    case "too_long":
      return "too_long";
    case "names_avalith":
      return "names_avalith";
    case "names_sender":
      return "names_sender";
  }
}

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const rows = (await db.execute(sql`
    select subject, generated_at from sequence_draft where subject is not null order by generated_at desc
  `)) as unknown as Array<{ subject: string; generated_at: Date }>;

  const counts = new Map<string, number>();
  let bad = 0;
  const offenders: string[] = [];

  for (const r of rows) {
    const violations = validateSubject(r.subject);
    if (violations.length === 0) continue;
    bad += 1;
    if (offenders.length < 15) offenders.push(`[${r.subject.length}] ${r.subject}`);
    for (const v of violations) counts.set(label(v), (counts.get(label(v)) ?? 0) + 1);
  }

  const pct = rows.length > 0 ? Math.round((bad / rows.length) * 1000) / 10 : 0;
  console.log(`live subjects: ${rows.length}`);
  console.log(`breaking the rule: ${bad} (${pct}%)`);
  console.log("\nby violation:");
  for (const [kind, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${kind}`);
  }
  console.log("\nsample offenders:");
  for (const o of offenders) console.log(`  ${o}`);

  process.exit(0);
}
void main();
