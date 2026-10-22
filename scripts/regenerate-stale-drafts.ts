/**
 * Owner-run regeneration of sequence drafts whose text predates a prompt-copy
 * change. A prompt change never rewrites drafts already in the database, so
 * after one, queued drafts still carry the old wording. This brings them in
 * line.
 *
 * It is a SCRIPT ON PURPOSE, never a button. The owner's standing rule is that
 * outreach drafts are generated one contact at a time, "para revisarlo bien y
 * personalizarlo" — a bulk affordance in the UI invites you not to read. This
 * does not defeat that rule: regenerating CLEARS `reviewed_at` and
 * `approved_at` (draftQueries.ts), and bulk approval is only enabled once every
 * selected draft was opened (bulkApprovalGate.ts, re-checked server-side). So a
 * run here forces the reads back rather than skipping them.
 *
 * It reuses `regenerateDrafts` (src/lib/sequences/draftQueries.ts), the exact
 * function the "Regenerar" card action calls. There is no second code path, so
 * every guard the UI has applies here:
 * - A HAND-EDITED draft is never replaced. `confirmed` is left empty on
 *   purpose; `blocksEditedOverwrite` (draftCompose.ts) then fails closed, and
 *   it is re-checked inside the transaction under a row lock, so an edit saved
 *   mid-run is caught too. Such a draft is reported in `skippedEdited`. The BD
 *   owns that text; regenerate it from its own card if you want it changed.
 * - A member whose compliance audience cannot be resolved is HELD. The hold
 *   branch runs BEFORE any draft write, so the existing text is kept intact,
 *   never replaced or blanked. Held ids need manual follow-up.
 *
 * --generated-before IS REQUIRED WITH --execute, and it is what makes this
 * script match its own name. Eligibility is otherwise decided by STATE alone,
 * which would regenerate a draft that already has the new wording: a wasted
 * model call, text thrown away that was already correct, and a pointless
 * re-read forced on the BD. There is deliberately NO default: the cutoff is the
 * instant the new prompt started generating, which only the operator knows, and
 * guessing it wrong silently spends money. It also makes a re-run after a
 * partial failure skip what already succeeded.
 *
 * SKIPPED, counted and reported but not an error: a member that is not
 * `drafted` (already sent or closed) and a hand-edited draft.
 * REFUSED, aborting the whole run with nothing written: a step-1 draft that is
 * `drafted` AND approved. Regenerating one would clear its approval and
 * un-schedule a send the owner already authorised. (That state is also
 * inconsistent data, since approving moves the member out of `drafted`.)
 *
 * KNOWN RACE: the eligibility SELECT happens once, and the run then takes one
 * model call per draft. Approving a draft in the UI mid-run would let this
 * un-approve it. Run it when nobody is working the sequence screen.
 *
 * THERE IS NO REVERT. `sequence_draft` keeps no history: the upsert replaces
 * `subject` and `body` in place. The text it overwrites is model-generated, not
 * hand-written (hand-written text is skipped, see above), but it is gone.
 *
 * COST: one model call per draft regenerated. Each member commits in its own
 * transaction, and a member whose generation fails keeps its old text — never a
 * blank one. `runDraftBatch` catches those errors instead of throwing, so this
 * script exits 1 when any member failed; a half-failed run must not look like
 * success.
 *
 * DRY RUN IS THE DEFAULT (it issues one SELECT and nothing else — it does not
 * open a read-only transaction, because it has no multi-statement read to make
 * consistent). Output is ids, flags and counts: no names, emails or phones.
 * Usage (do NOT run --execute without the owner's approval):
 *   npx tsx --env-file=.env scripts/regenerate-stale-drafts.ts --actor=<bd id> [--sequence=<id>] [--generated-before=<iso>]
 *   npx tsx --env-file=.env scripts/regenerate-stale-drafts.ts --actor=<bd id> --generated-before=<iso> --execute [--sequence=<id>]
 *
 * EXIT CODES: 0 success (dry run, or a run where every member succeeded);
 * 1 bad arguments, a refusal (nothing written), or a run with any failure.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { regenerateDrafts } from "../src/lib/sequences/draftQueries";

const STEP = 1;

interface Candidate {
  sequence_id: string;
  member_id: string;
  state: string;
  hand_edited: boolean;
  approved: boolean;
  generated_at: string;
}

function parseArgs(argv: readonly string[]) {
  let actor: string | null = null;
  let sequence: string | null = null;
  let generatedBefore: string | null = null;
  let execute = false;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--sequence=")) sequence = arg.slice("--sequence=".length);
    else if (arg.startsWith("--generated-before=")) generatedBefore = arg.slice("--generated-before=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --actor=<bd id>, --sequence=<id>, --generated-before=<iso>, --execute`);
  }
  if (!actor) throw new Error("Usage: regenerate-stale-drafts.ts --actor=<bd id> [--sequence=<id>] [--generated-before=<iso>] [--execute]");
  if (generatedBefore !== null && Number.isNaN(Date.parse(generatedBefore))) {
    throw new Error(`--generated-before=${generatedBefore} is not a parseable instant. Pass an ISO 8601 timestamp, e.g. 2026-10-22T18:54:06Z.`);
  }
  // No default: see this file's doc comment. A guessed cutoff spends money silently.
  if (execute && !generatedBefore) throw new Error("--execute requires --generated-before=<iso>: the instant the new prompt started generating. Without it, drafts that already carry the new wording would be regenerated too.");
  return { actor, sequence, generatedBefore, execute };
}

/** Every step-1 draft of a sequence the actor owns, with the flags that decide eligibility. */
async function loadCandidates(actor: string, sequence: string | null, generatedBefore: string | null): Promise<Candidate[]> {
  const rows = await db.execute(sql`
    select s.id::text as sequence_id, sm.id::text as member_id, sm.state, d.generated_at,
           d.edited_at is not null as hand_edited,
           d.approved_at is not null as approved
    from sequence_draft d
    join sequence_member sm on sm.id = d.sequence_member_id
    join sequence s on s.id = sm.sequence_id
    where s.owner_bd_id = ${actor}::uuid and d.step = ${STEP}
      ${sequence ? sql`and s.id = ${sequence}::uuid` : sql``}
      ${generatedBefore ? sql`and d.generated_at < ${generatedBefore}::timestamptz` : sql``}
    order by s.name, sm.id`);
  return rows as unknown as Candidate[];
}

const verdictOf = (c: Candidate): "regenerate" | "skip_not_drafted" | "skip_hand_edited" | "refuse_approved" =>
  c.state !== "drafted" ? "skip_not_drafted" : c.approved ? "refuse_approved" : c.hand_edited ? "skip_hand_edited" : "regenerate";

async function main(): Promise<number> {
  const { actor, sequence, generatedBefore, execute } = parseArgs(process.argv.slice(2));
  const candidates = await loadCandidates(actor, sequence, generatedBefore);
  const scope = `owner ${actor}${sequence ? `, sequence ${sequence}` : ""}${generatedBefore ? `, generated before ${generatedBefore}` : ", ANY generation time"}`;
  if (candidates.length === 0) {
    console.log(`No step-${STEP} drafts found for ${scope}.`);
    return 0;
  }

  const tally = new Map<string, number>();
  for (const c of candidates) tally.set(verdictOf(c), (tally.get(verdictOf(c)) ?? 0) + 1);
  console.log(`${candidates.length} step-${STEP} draft(s) for ${scope}:`);
  for (const [verdict, n] of [...tally].sort()) console.log(`  ${verdict}: ${n}`);

  const approved = candidates.filter((c) => verdictOf(c) === "refuse_approved");
  if (approved.length > 0) {
    console.error(`\nREFUSING: ${approved.length} draft(s) are approved. Regenerating one would clear its approval and un-schedule its send.`);
    for (const c of approved) console.error(`  member ${c.member_id} (sequence ${c.sequence_id})`);
    console.error("Nothing was written. Un-approve them by hand first, or pass --sequence to exclude them.");
    return 1;
  }

  const eligible = candidates.filter((c) => verdictOf(c) === "regenerate");
  const bySequence = new Map<string, string[]>();
  for (const c of eligible) bySequence.set(c.sequence_id, [...(bySequence.get(c.sequence_id) ?? []), c.member_id]);

  console.log(`\nEligible: ${eligible.length} draft(s) across ${bySequence.size} sequence(s).`);
  for (const [sequenceId, memberIds] of bySequence) console.log(`  sequence ${sequenceId}: ${memberIds.length} member(s)`);
  if (eligible.length > 0) {
    const times = eligible.map((c) => String(c.generated_at)).sort();
    console.log(`  generated between ${times[0]} and ${times[times.length - 1]}`);
  }

  if (!execute) {
    console.log("\nDRY RUN: nothing written. Re-run with --execute (and --generated-before) to regenerate.");
    console.log(`Cost if executed: ${eligible.length} model call(s). There is no revert.`);
    return 0;
  }
  if (eligible.length === 0) {
    console.log("\nNothing eligible to regenerate.");
    return 0;
  }

  console.log("\nEXECUTING. Hand-edited drafts are left alone (no confirmations are passed).");
  let failures = 0;
  for (const [sequenceId, memberIds] of bySequence) {
    const r = await regenerateDrafts(actor, sequenceId, memberIds);
    console.log(`  sequence ${sequenceId}: ${JSON.stringify(r)}`);
    // runDraftBatch catches a member's generation error into `failed` instead of
    // throwing, so a half-failed run would otherwise exit 0 and read as success.
    const failed = (r as { failed?: readonly unknown[] }).failed ?? [];
    failures += failed.length;
  }
  if (failures > 0) {
    console.error(`\n${failures} member(s) FAILED to regenerate and kept their old text. Re-run with the same --generated-before to retry only those.`);
    return 1;
  }
  console.log("\nDone, with no failures. Every regenerated draft is back to unopened, so each one must be opened again before it can be approved.");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
