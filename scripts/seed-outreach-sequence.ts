/**
 * Seeds the owner's first real Sequence, "Florida + US · octubre", from the nine Contacts left of the ten he hand-picked on 2026-10-14.
 * The roster and every admission rule live in src/lib/sequences/seedRoster.ts; the DB work in seedQueries.ts.
 *
 * THE RULE THAT MATTERS: the list is months-old news by the time this runs, so EVERY candidate is re-validated at run
 * time (non-merged with an email, company still has an open IT posting, company is not a client of either status,
 * address not suppressed, max 2 per company). Anyone who drops off is reported by name with the reason and left out.
 * The script NEVER picks a replacement: a Contact the owner did not choose, emailed under his name, is far worse than
 * a short list. A name that matches zero or several people stops the run before anything is written.
 *
 * WHAT IT WRITES (only with --apply): one sequence row, one sequence_member row per admitted Contact in state
 * "drafted", one audit_log row (action 'seed_outreach_sequence'), all in ONE transaction; then each member's step 1
 * draft through the real drafting path (market-keyed language and footer). It never sets approved_at, sent_at or a
 * hold: approving and sending are human acts in later PRs.
 *
 * IDEMPOTENT: re-running against the same sequence name adds nothing and writes no audit row. A member removed by hand
 * stays removed. A re-run may add a roster Contact who was never a member and now qualifies, and fills in a draft that
 * failed last time; with nothing to add it is a no-op.
 *
 * DRY RUN IS THE DEFAULT (a read-only transaction, so it cannot write by construction). Usage:
 *   npx tsx --env-file=.env.local scripts/seed-outreach-sequence.ts
 *   npx tsx --env-file=.env.local scripts/seed-outreach-sequence.ts --apply --actor=<bd id>
 * Do NOT run --apply without the owner's approval of the dry-run output.
 *
 * EXIT CODES: 0 success (dry run, write, or nothing to do); 1 bad arguments, an unresolvable roster entry, or any
 * failed check (nothing written).
 */
import { parseSeedArgs, SEED_SEQUENCE_NAME } from "../src/lib/sequences/seedRoster";
import { seedFirstSequence, type SeedResult } from "../src/lib/sequences/seedQueries";

function print(r: SeedResult, apply: boolean) {
  const { plan } = r;
  console.log(apply ? "APPLY\n" : "DRY RUN (read-only transaction, nothing is written)\n");
  console.log(`Sequence:  ${SEED_SEQUENCE_NAME} (${plan.existingSequenceId ? `exists, id ${plan.existingSequenceId}` : "does not exist yet"})`);
  console.log(`Owner:     ${plan.owner.name} (${plan.owner.id})`);
  console.log(`Sends from: ${plan.account.emailAddress}\n`);
  console.log(`ADMITTED (${plan.resolution.admitted.length})`);
  for (const c of plan.resolution.admitted) {
    const line = plan.lines.find((l) => l.candidate.personId === c.personId)!;
    console.log(`  + ${c.label}  market=${line.market}  draft language=${line.language ?? "none (would be held: unmapped market)"}`);
  }
  console.log(`\nLEFT OUT (${plan.resolution.rejected.length}), never replaced`);
  for (const x of plan.resolution.rejected) {
    const line = plan.lines.find((l) => l.candidate.personId === x.candidate.personId)!;
    console.log(`  - ${x.candidate.label}: ${x.reason}  (market=${line.market}, language=${line.language ?? "none"})`);
  }
  if (!apply) return void console.log("\nNothing written. Re-run with --apply --actor=<bd id> to apply.");
  if (r.applied) console.log(`\nDone. ${r.createdSequence ? "Created the Sequence and added" : "Added"} ${r.addedPersonIds.length} member(s), all in state 'drafted'. audit_log id: ${r.auditLogId}`);
  else console.log("\nNothing to add. No audit row written.");
  // Drafting runs even when nothing was added (it fills in members that still have no draft), so always report it.
  if (!r.drafts) console.log("Drafts: skipped (sequence not found for owner)");
  else {
    console.log(`Drafts: generated=${r.drafts.generated} failed=${r.drafts.failed} held=${r.drafts.held}`);
    for (const f of r.drafts.failures) console.log(`  ! member ${f.memberId}: ${f.reason}`);
  }
}

async function main() {
  const { apply, actor } = parseSeedArgs(process.argv.slice(2));
  print(await seedFirstSequence({ actorBdId: actor, apply }), apply);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
