/**
 * Pure planner for scripts/backfill-rfc-message-ids.ts. Messages synced
 * before migration 0036 have no `rfc_message_id`, so they cannot be replied
 * to as a real thread reply. The script re-reads those messages from Gmail;
 * this turns the result into the exact updates to write.
 *
 * `fetched` is keyed by `backfillKey(bdId, gmailMessageId)` — the ONE key
 * builder, used by the script that fills the map and by this planner that
 * reads it (a Gmail message id is only unique within one mailbox).
 */
import type { ParsedGmailMessage } from "./parseMessage";

export interface BackfillCandidate {
  id: string;
  bdId: string;
  gmailMessageId: string;
}

export interface BackfillUpdate {
  id: string;
  rfcMessageId: string;
  rfcReferences: string | null;
}

export interface BackfillPlan {
  updates: BackfillUpdate[];
  counts: { candidates: number; update: number; notFoundInGmail: number; noMessageIdHeader: number };
}

export function backfillKey(bdId: string, gmailMessageId: string): string {
  return `${bdId}:${gmailMessageId}`;
}

export function planRfcBackfill(
  candidates: readonly BackfillCandidate[],
  fetched: ReadonlyMap<string, ParsedGmailMessage>,
): BackfillPlan {
  const updates: BackfillUpdate[] = [];
  let notFoundInGmail = 0;
  let noMessageIdHeader = 0;
  for (const c of candidates) {
    const parsed = fetched.get(backfillKey(c.bdId, c.gmailMessageId));
    if (!parsed) {
      notFoundInGmail++;
    } else if (!parsed.rfcMessageId) {
      noMessageIdHeader++;
    } else {
      updates.push({ id: c.id, rfcMessageId: parsed.rfcMessageId, rfcReferences: parsed.references });
    }
  }
  return {
    updates,
    counts: { candidates: candidates.length, update: updates.length, notFoundInGmail, noMessageIdHeader },
  };
}
