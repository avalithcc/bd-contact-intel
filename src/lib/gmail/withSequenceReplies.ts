/**
 * Post-write hook of the Gmail sync (outreach-sequences task 10.6): once a batch is stored, hand it to Sequence reply
 * handling. Installed on the ONE `writeMessages` dep that the incremental sync and the first-sync backfill share
 * (syncOneAccountNow.ts), so both paths get it.
 *
 * The hook sits in its own try/catch and a failure is logged and swallowed. That is the whole point of this file: an
 * exception escaping here would propagate out of the sync before the cursor advances and wedge mail sync for every BD,
 * and mail sync matters more than any Sequence feature. A write failure, on the other hand, is the sync's own error and
 * still propagates, with the hook skipped.
 *
 * The cost of swallowing is stated plainly: the hook only ever sees NEWLY synced messages, so a failed attempt is NOT
 * retried and `sequence_member.replied_at` / the withdrawn reminder stay unwritten for that reply. That is safe only
 * because the hook is an optimisation, not the safeguard: the runner decides from email_message itself
 * (preSendChecks `inboundReplyAt`, and the claim), so a lost hook run costs a stale UI state, never a reminder sent
 * to someone who answered.
 */
import type { ClassifiedMessage } from "./classify";

export type WriteMessages = (classified: ClassifiedMessage[]) => Promise<{ inserted: number }>;

export function withSequenceReplies(
  write: WriteMessages,
  applyReplies: (messages: ClassifiedMessage[]) => Promise<unknown>,
  log: (...args: unknown[]) => void = console.error,
): WriteMessages {
  return async (classified) => {
    const result = await write(classified);
    try {
      await applyReplies(classified);
    } catch (error) {
      log("[gmail-sync] sequence reply handling failed; the sync carries on", error);
    }
    return result;
  };
}
