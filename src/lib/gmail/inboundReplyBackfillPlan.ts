// Pure half of the backfill (no `@/db`), so the plan and the cap are unit-tested.
import { planInboundReplyBatch, type InboundReplyPromotion } from "./inboundReplyVerification";

/** A run beyond this refuses to write (all or nothing); re-run after reviewing the dry run. */
export const BACKFILL_ROW_CAP = 2000;

export interface ReplyBackfillCandidate {
  id: string;
  emailNormalized: string;
  emailStatus: string;
  emailSource: string | null;
  replyFrom: string;
  liveHolders: number;
}

/** The read fetches cap + 1 rows, so exceeding the cap is detectable without a count. */
export function assertWithinBackfillCap(candidates: readonly unknown[]): void {
  if (candidates.length > BACKFILL_ROW_CAP) throw new Error(`more than ${BACKFILL_ROW_CAP} candidates: review the dry run and raise the cap deliberately`);
}

export function planReplyBackfill(candidates: readonly ReplyBackfillCandidate[]): InboundReplyPromotion[] {
  return planInboundReplyBatch(
    candidates.map((c) => ({
      person: { id: c.id, emailNormalized: c.emailNormalized, emailStatus: c.emailStatus, mergedIntoId: null, liveHolders: c.liveHolders },
      message: { direction: "inbound" as const, fromAddress: c.replyFrom },
    })),
  );
}
