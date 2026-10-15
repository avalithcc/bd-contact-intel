/**
 * One-off, owner-gated: promotes email_status to 'verified' for Contacts who ALREADY replied
 * (an inbound email_message whose from_address equals the stored person.email_normalized)
 * before the Gmail sync did this on its own. Same rule as the sync, same pure planner
 * (src/lib/gmail/inboundReplyVerification.ts): exact address only, never a downgrade, and
 * email_source / email_confidence stay untouched.
 *
 * Dry run is the default and prints counts only (never an address or id). Writing needs
 * `--apply --actor=<bd id>`. Everything runs in ONE transaction: the guarded UPDATEs, one
 * person_property_history row per changed Contact (property emailStatus, source 'inbound_reply',
 * changed_by_bd_id NULL) and one audit_log row (action inbound_reply_verified_backfill). More
 * than BACKFILL_ROW_CAP candidates refuses to write.
 *
 * Revert (from the audit_log metadata, which holds the ids split by previous status):
 *   update person set email_status = 'probable' where id in (<previouslyProbableIds>);
 *   update person set email_status = 'none'     where id in (<previouslyNoneIds>);
 *   delete from person_property_history where source = 'inbound_reply' and property = 'emailStatus'
 *     and new_value = 'verified' and person_id in (<both lists>) and at >= <audit_log.at>;
 *
 * Usage:
 *   npx tsx scripts/backfill-inbound-reply-verified.ts                          # dry run (default)
 *   npx tsx scripts/backfill-inbound-reply-verified.ts --apply --actor=<bd id>  # writes
 */
import {
  BACKFILL_ROW_CAP,
  executeReplyBackfill,
  planReplyBackfill,
  readReplyBackfillCandidates,
} from "../src/lib/gmail/inboundReplyBackfillQueries";
import { db } from "../src/db";

function parseArgs(argv: readonly string[]) {
  let apply = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
  }
  return { apply, actor };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.actor) throw new Error("--apply requires --actor=<bd id> for the audit log");

  const candidates = await readReplyBackfillCandidates(db);
  const capped = candidates.length > BACKFILL_ROW_CAP;
  const rows = planReplyBackfill(candidates);

  const tally = new Map<string, number>();
  const sourceOf = new Map(candidates.map((c) => [c.id, c.emailSource ?? "(null)"] as const));
  for (const r of rows) {
    const key = `${r.historyRow.oldValue} / ${sourceOf.get(r.historyRow.personId)}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  console.log(`Contacts that replied from their stored address and are not verified: ${rows.length}${capped ? ` (cap ${BACKFILL_ROW_CAP} exceeded: apply will refuse)` : ""}`);
  console.log("By previous email_status / email_source:");
  for (const [key, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  - ${key}: ${n}`);

  if (!args.apply) {
    console.log("\nDry run only, no writes performed. Re-run with --apply --actor=<bd id> to write.");
    return;
  }
  const result = await executeReplyBackfill(args.actor!);
  console.log(`\nUpdated ${result.updatedPersonIds.length} person row(s) to email_status = 'verified'.`);
  if (result.updatedPersonIds.length !== rows.length) {
    console.log(`NOTE: updated (${result.updatedPersonIds.length}) differs from the dry run (${rows.length}); data changed in between. The audit_log row records what happened.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
