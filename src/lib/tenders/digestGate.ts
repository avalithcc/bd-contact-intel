/**
 * The tender half of the daily digest behind the module switch. DB-free: the reads arrive as functions, so a test can pass
 * spies that fail when called. When the module is paused NOTHING is read, so no tender can reach a recipient.
 */
import { TENDERS_ENABLED } from "@/lib/tenders/enabled";
import { planTenderDigest, type ClosingTenderRow, type DigestBd, type PlannedBd } from "@/lib/tenders/digestPlan";

export interface TenderDigestReads {
  getClosing: (now: Date) => Promise<ClosingTenderRow[]>;
  getRecipients: () => Promise<DigestBd[]>;
}

export async function loadTenderDigestPlan(now: Date, reads: TenderDigestReads, enabled: boolean = TENDERS_ENABLED): Promise<Map<string, PlannedBd>> {
  if (!enabled) return new Map();
  const closing = await reads.getClosing(now);
  const everyone = closing.length > 0 ? await reads.getRecipients() : [];
  return planTenderDigest(closing, everyone, now);
}
