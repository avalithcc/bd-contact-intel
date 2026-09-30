/**
 * Owner-run bulk-merge CLI for the /admin/duplicates queue (backlog: work
 * the queue in bulk instead of one pair at a time through the UI).
 *
 * Re-derives every open duplicate_candidate pair's tier FROM THE DATABASE at
 * run time (src/lib/identity/duplicateTiering.ts) — nothing here hardcodes
 * ids or counts, since the queue changes between runs. See that module's
 * header comment for the bucket/tier rules.
 *
 * DEPENDENCY: assumes mergeContacts (src/lib/identity/mergeDb.ts) correctly
 * repoints email_message_person and follow_up_queue_item onto the survivor
 * (fix/merge-repoint-email-queue). Nothing here works around that — it
 * reuses mergeContacts as-is and must not run against production until that
 * fix has landed.
 *
 * Transitive chains (a person appearing in more than one open pair) are
 * ALWAYS skipped, in both tiers, and reported separately rather than
 * auto-merged in some guessed order — see duplicateTiering.ts's
 * findChainedPersonIds doc comment. This makes a half-merged chain
 * structurally impossible: nothing in a chain is ever written by this
 * script.
 *
 * Survivor guard: chooseDefaultSurvivor (duplicateReviewView.ts, reused
 * as-is, not reimplemented) only compares profile_key and earliest
 * connection date — it does not know about synced Gmail message counts. A
 * pair is skipped (not guessed) whenever the side it would pick as survivor
 * has no synced messages while the losing side does, or lacks a
 * profile_key the losing side has (checkSurvivorLoss).
 *
 * Writes: one `mergeContacts` transaction PER PAIR (never a parallel merge
 * implementation — it's the exact function the /admin/duplicates UI uses),
 * run strictly SEQUENTIALLY (the prod pool is `max: 3` and every round trip
 * already costs ~222ms — fanning out concurrently would only interleave
 * queries on the same pool, not speed anything up; see PERFORMANCE.md). One
 * extra `audit_log` row summarizes the whole run (action
 * `bulk_merge_duplicates_run`), listing every merged pair, for full
 * traceability and revert.
 *
 * Idempotent: a merged duplicate_candidate leaves `status='open'`
 * (mergeContacts marks it `'merged'`), so a second `--execute` simply finds
 * nothing left to do for that pair — the open-pairs read naturally excludes
 * it.
 *
 * Retired: `--tier=dismiss` (2026-09). It used to mark a
 * `two_emails_differ_verified` pair `not_duplicate` permanently, with no
 * revert path. Of the 9 production pairs that ever went through it, only 2
 * were genuinely two different people; the other 7 were one person with a
 * ccTLD domain, a dot separator, a middle initial, an accented local part, a
 * two-letter typo, a short vs. full name, or a personal address next to a
 * work one. See duplicateTiering.ts's module doc comment for the full
 * account. Dismissal is now exclusively a human call in /admin/duplicates;
 * passing `--tier=dismiss` here fails fast with a pointer to that page.
 *
 * Usage (dry run by default — never writes):
 *   npx tsx scripts/merge-duplicates.ts --tier=safe
 *
 * Execute (writes; requires an explicit tier and actor):
 *   npx tsx scripts/merge-duplicates.ts --tier=safe --execute --actor=<bd id>
 *
 * Revert everything a run merged (newest merge first):
 *   npx tsx scripts/merge-duplicates.ts --revert=<runId> --actor=<bd id>
 *
 * Requires DATABASE_URL to be set (see .env). Do NOT run automatically —
 * this reads and, on --execute/--revert, writes the real database.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, bd } from "../src/db/schema";
import { mergeContacts, unmergeContact } from "../src/lib/identity/mergeDb";
import { mergeProperty } from "../src/lib/identity/matcher";
import { loadOpenDuplicatePairsForTiering } from "../src/lib/identity/duplicateBulkQueries";
import {
  planDuplicateTierRun,
  pickEmailWinnerSide,
  type DuplicatePairPlanInput,
  type DuplicateTierPlan,
} from "../src/lib/identity/duplicateTiering";

const RUN_ACTION = "bulk_merge_duplicates_run";
const REVERT_ACTION = "bulk_merge_duplicates_revert";

interface CliArgs {
  tier?: "safe";
  execute: boolean;
  actor?: string;
  revert?: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { execute: false };
  for (const raw of argv) {
    if (raw === "--execute") args.execute = true;
    else if (raw.startsWith("--tier=")) {
      const value = raw.slice("--tier=".length);
      if (value === "dismiss") {
        throw new Error(
          "--tier=dismiss was retired: automatic dismissal was wrong 7 times out of 9 in production and has no revert path. " +
            "Dismiss duplicate_candidate pairs by hand in /admin/duplicates instead.",
        );
      }
      if (value !== "safe") {
        throw new Error(`Invalid --tier: ${value} (must be "safe")`);
      }
      args.tier = value;
    } else if (raw.startsWith("--actor=")) args.actor = raw.slice("--actor=".length);
    else if (raw.startsWith("--revert=")) args.revert = raw.slice("--revert=".length);
    else throw new Error(`Unknown argument: ${raw}`);
  }
  return args;
}

function displayName(p: { firstName: string | null; lastName: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || "(sin nombre)";
}

function yesNo(v: unknown): "yes" | "no" {
  return v ? "yes" : "no";
}

function personLine(
  label: string,
  p: DuplicatePairPlanInput["personA"],
  ownerNameById: ReadonlyMap<string, string>,
): string {
  const owner = p.ownerBdId ? (ownerNameById.get(p.ownerBdId) ?? p.ownerBdId) : "(none)";
  return `    ${label}: ${displayName(p)} | email=${yesNo(p.email)} profileKey=${yesNo(p.profileKey)} title="${p.jobTitle ?? ""}" owner=${owner}`;
}

/** Prints the overall bucket/tier breakdown (every open pair, regardless of --tier) plus a per-pair report for the selected tier. */
function printReport(plan: DuplicateTierPlan, pairs: readonly DuplicatePairPlanInput[], ownerNameById: ReadonlyMap<string, string>): void {
  console.log(`Open pairs analyzed: ${pairs.length}`);
  console.log("Bucket counts (all open pairs):");
  for (const [bucket, count] of Object.entries(plan.bucketCounts)) {
    console.log(`  ${bucket}: ${count}`);
  }
  console.log("Tier counts (all open pairs):");
  console.log(`  safe: ${plan.tierCounts.safe}`);
  console.log(`  review (untouched by this script): ${plan.tierCounts.review}`);

  const pairByCandidateId = new Map(pairs.map((p) => [p.candidateId, p]));
  console.log(`\n--tier=${plan.tier} selection (${plan.entries.length} pairs matched this tier):`);

  for (const entry of plan.entries) {
    const pair = pairByCandidateId.get(entry.candidateId);
    if (!pair) continue;
    console.log(`\n  [${entry.candidateId}] reason=${entry.reason} bucket=${entry.bucket}`);
    console.log(personLine("A", pair.personA, ownerNameById));
    console.log(personLine("B", pair.personB, ownerNameById));

    if (entry.kind === "skip_chain") {
      console.log(`    SKIP (transitive chain): a person in this pair appears in another open pair too — reported separately, not merged.`);
      continue;
    }
    if (entry.kind === "skip_survivor_loss") {
      const reasons = [
        entry.loss.losesGmailMessages ? "would lose the side with synced Gmail messages" : null,
        entry.loss.losesProfileKey ? "would lose the side with the profile_key" : null,
      ].filter(Boolean);
      console.log(`    SKIP (survivor guard): ${reasons.join("; ")} — not guessing, needs a human.`);
      continue;
    }
    // kind === "merge"
    const survivor = entry.survivorId === pair.personA.id ? pair.personA : pair.personB;
    const merged = entry.mergedId === pair.personA.id ? pair.personA : pair.personB;
    console.log(`    WOULD MERGE: survivor=${displayName(survivor)} (${survivor.id}), merged=${displayName(merged)} (${merged.id})`);
    const titleOutcome = mergeProperty({ value: survivor.jobTitle }, { value: merged.jobTitle });
    const titleLoss = titleOutcome.loser?.value ?? null;

    // Mirrors planMerge's mergeEmailFields winner rule via pickEmailWinnerSide
    // (duplicateTiering.ts) so this dry-run line can never disagree with what
    // the merge actually writes. An email loss can happen whenever the two
    // sides' emails differ (always true for two_emails_same_mailbox, but not
    // special-cased to that bucket — the same computation applies to any
    // bucket where both sides happen to carry a differing email).
    let emailLoss: string | null = null;
    if (survivor.email && merged.email && survivor.email !== merged.email) {
      const winnerSide = pickEmailWinnerSide(
        { email: survivor.email, emailStatus: survivor.emailStatus },
        { email: merged.email, emailStatus: merged.emailStatus },
      );
      emailLoss = winnerSide === "survivor" ? merged.email : survivor.email;
    }

    if (titleLoss) {
      console.log(`    would lose jobTitle "${titleLoss}" from the merged side.`);
    }
    if (emailLoss) {
      const keptEmail = emailLoss === survivor.email ? merged.email : survivor.email;
      console.log(
        `    would discard email "${emailLoss}" (survivor keeps "${keptEmail}") — recorded in the merge snapshot, restorable via unmerge.`,
      );
    }
    if (!titleLoss && !emailLoss) {
      console.log(`    no property loss expected (email/profile_key/title agree or fill in cleanly).`);
    }
  }
}

async function loadOwnerNameById(): Promise<Map<string, string>> {
  const rows = await db.select({ id: bd.id, name: bd.name }).from(bd);
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function assertActorExists(actorBdId: string): Promise<void> {
  const [row] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, actorBdId));
  if (!row) throw new Error(`Refusing to run: no bd row for --actor=${actorBdId}`);
}

interface MergedRecord {
  candidateId: string;
  mergeEventId: string;
  survivorId: string;
  mergedId: string;
}

async function runExecute(plan: DuplicateTierPlan, actorBdId: string): Promise<void> {
  const runId = randomUUID();
  const merged: MergedRecord[] = [];
  const errors: { candidateId: string; kind: string; message: string }[] = [];

  // Sequential on purpose (PERFORMANCE.md, query rule 7): the prod pool is
  // max:3 and every round trip already costs ~222ms — running these
  // concurrently would only interleave on the same pool, not parallelize.
  for (const entry of plan.entries) {
    if (entry.kind === "merge") {
      try {
        const { mergeEventId } = await mergeContacts(db, entry.survivorId, entry.mergedId, entry.reason, actorBdId);
        merged.push({ candidateId: entry.candidateId, mergeEventId, survivorId: entry.survivorId, mergedId: entry.mergedId });
        console.log(`merged ${entry.candidateId}: survivor=${entry.survivorId} merged=${entry.mergedId} mergeEventId=${mergeEventId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ candidateId: entry.candidateId, kind: "merge", message });
        console.error(`FAILED to merge ${entry.candidateId}: ${message}`);
      }
    }
    // skip_chain / skip_survivor_loss entries are never executed.
  }

  const skippedSurvivorLossCandidateIds = plan.entries.filter((e) => e.kind === "skip_survivor_loss").map((e) => e.candidateId);

  await db.insert(auditLog).values({
    actorBdId,
    action: RUN_ACTION,
    metadata: {
      runId,
      tier: plan.tier,
      merged,
      skippedChainCandidateIds: plan.chainedCandidateIds,
      skippedSurvivorLossCandidateIds,
      errors,
    },
  });

  console.log(`\nRun ${runId}: merged ${merged.length}, ${errors.length} error(s).`);
  console.log(`Skipped (chain): ${plan.chainedCandidateIds.length}. Skipped (survivor guard): ${skippedSurvivorLossCandidateIds.length}.`);
  if (merged.length > 0) {
    console.log(`To revert this run: npx tsx scripts/merge-duplicates.ts --revert=${runId} --actor=<bd id>`);
  }
}

async function runRevert(runId: string, actorBdId: string): Promise<void> {
  const [row] = await db
    .select({ metadata: auditLog.metadata })
    .from(auditLog)
    .where(and(eq(auditLog.action, RUN_ACTION), sql`${auditLog.metadata}->>'runId' = ${runId}`));
  if (!row) throw new Error(`Refusing to revert: no ${RUN_ACTION} audit_log row found for runId=${runId}`);

  const metadata = row.metadata as { merged?: MergedRecord[] };
  const merged = metadata.merged ?? [];
  if (merged.length === 0) {
    console.log(`Run ${runId} merged nothing — nothing to revert.`);
    return;
  }

  // Newest first: `merged` was appended in the run's (deterministic,
  // candidateId-ordered) execution order, so reversing it undoes the most
  // recently created merge_event first.
  const newestFirst = [...merged].reverse();
  const reverted: string[] = [];
  const errors: { mergeEventId: string; message: string }[] = [];

  for (const m of newestFirst) {
    try {
      await unmergeContact(db, m.mergeEventId, actorBdId);
      reverted.push(m.mergeEventId);
      console.log(`unmerged ${m.mergeEventId} (candidate ${m.candidateId})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ mergeEventId: m.mergeEventId, message });
      console.error(`FAILED to unmerge ${m.mergeEventId}: ${message}`);
    }
  }

  await db.insert(auditLog).values({
    actorBdId,
    action: REVERT_ACTION,
    metadata: { runId, revertedMergeEventIds: reverted, errors },
  });

  console.log(`\nReverted ${reverted.length}/${merged.length} merge(s) from run ${runId}. ${errors.length} error(s).`);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.revert) {
    if (!args.actor) throw new Error("Refusing to revert: pass --actor=<bd id>.");
    await assertActorExists(args.actor);
    await runRevert(args.revert, args.actor);
    return;
  }

  if (!args.tier) {
    throw new Error("Refusing to run: pass an explicit --tier=safe (or --revert=<runId> --actor=<bd id>).");
  }

  const [pairs, ownerNameById] = await Promise.all([loadOpenDuplicatePairsForTiering(), loadOwnerNameById()]);
  const plan = planDuplicateTierRun(pairs, args.tier);

  printReport(plan, pairs, ownerNameById);

  if (!args.execute) {
    console.log("\nDry run only (default) — pass --execute --actor=<bd id> to write.");
    return;
  }

  if (!args.actor) throw new Error("Refusing to execute: pass --actor=<bd id>.");
  await assertActorExists(args.actor);
  await runExecute(plan, args.actor);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
