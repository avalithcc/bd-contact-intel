/**
 * Read-only: the two facts that decide whether a Sequence email is signed once and opens well.
 *
 * 1. Which BDs have a USABLE signature. "Usable" is not "not null": both send paths run the stored HTML through
 *    `sanitizeSignatureHtml` and treat an empty result as no signature at all (composeReleaseBody for Sequences,
 *    composeEmailBody for one-off and scheduled mail), so this calls that same function rather than re-deriving the
 *    rule. It is load-bearing for the prompt too: `signatureFollows` tells the generator not to sign off in the body,
 *    and it is computed from this exact test — if the two ever disagree, the email is double-signed or unsigned.
 *
 * 2. What the live draft subjects look like, with their lengths. The subject rule targets 35-50 characters and forbids
 *    naming Avalith or the vendor's own services; this is how you see whether a regenerated batch actually complies.
 *    The Avalith check is a real regression guard, not a curiosity: four drafts were SENT in October 2026 with the
 *    subject "Capacidad senior de ingenieria para Avalith" to contacts at other companies, because an untracked
 *    company left the prompt with no recipient name and Avalith's was the only one in context.
 *
 * Usage: npx tsx --env-file=.env scripts/measure/draft-subject-and-signature.ts
 *
 * Prints BD names, draft subjects and recipient company names: local only, never into a PR body or any other shared
 * artifact (README rule 4).
 *
 * GUARD SCOPE (README rule 1): the guard covers the one connection it is set on, not the pool; the reads here are
 * sequential, and `sanitizeSignatureHtml` is pure.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { sanitizeSignatureHtml } from "@/lib/signature/sanitize";

type Row = Record<string, unknown>;
const rows = (r: unknown) => r as unknown as Row[];

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)}\n`);

  console.log("=== BD signatures (usable = survives sanitizeSignatureHtml) ===");
  const bds = await db.execute(sql`select name, email, signature_html from bd order by name`);
  for (const r of rows(bds)) {
    const raw = (r.signature_html ?? null) as string | null;
    const usable = raw ? sanitizeSignatureHtml(raw) : "";
    const verdict = usable === "" ? "NO SIGNATURE" : "usable     ";
    console.log(`${verdict} | ${String(r.name)} <${String(r.email)}> | ${usable.length} chars`);
  }

  console.log("\n=== Most recent draft subjects ===");
  const subjects = await db.execute(sql`
    select d.subject, length(d.subject) as len, d.step, m.state, s.name as sequence_name
    from sequence_draft d
    join sequence_member m on m.id = d.sequence_member_id
    join sequence s on s.id = m.sequence_id
    order by d.generated_at desc
    limit 40
  `);
  for (const r of rows(subjects)) {
    const len = Number(r.len);
    // The rule asks for 35-50 and hard-caps at 60. Flag what falls outside so a drifting batch is visible at a glance.
    const flag = len > 60 ? "TOO LONG" : len < 35 || len > 50 ? "off-band" : "        ";
    console.log(`${flag} [step ${String(r.step)} ${String(r.state)}] (${len}) ${String(r.subject)}   -- ${String(r.sequence_name)}`);
  }

  console.log("\n=== Regression guards ===");
  const guards = await db.execute(sql`
    select
      count(*)::int as drafts,
      count(*) filter (where d.subject ilike '%avalith%')::int as subject_names_avalith,
      count(*) filter (where length(d.subject) > 60)::int as subject_over_60
    from sequence_draft d
  `);
  console.log(JSON.stringify(rows(guards)[0]));

  // Any draft whose subject names the sender's own company is a sent-to-the-wrong-company defect; print the recipient
  // so the row can be found, and say nothing at all when there are none.
  const avalith = await db.execute(sql`
    select d.subject, p.company, p.company_key
    from sequence_draft d
    join sequence_member m on m.id = d.sequence_member_id
    join person p on p.id = m.person_id
    where d.subject ilike '%avalith%'
  `);
  for (const r of rows(avalith)) {
    console.log(`  subject names Avalith -> recipient company: ${String(r.company ?? "(not on file)")} [${String(r.company_key)}]`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
