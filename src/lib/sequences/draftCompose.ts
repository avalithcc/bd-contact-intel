/**
 * Pure pieces of drafting: footer attachment, the save-time footer check and the sequential batch runner. No DB, no
 * model. The footer is attached HERE, by the system, after the model has finished: the model is never asked for an
 * address or an opt-out line, so no prompt rule can be skipped, and the BD approves the exact text that will be sent.
 */
import type { MarketKey } from "@/lib/hiring/markets";
import { appendFooter, bodyHasFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";

export interface GeneratedEmail {
  subject: string;
  body: string;
}

export const isMarketMapped = (market: MarketKey): boolean => Object.hasOwn(COMPLIANCE_CONFIG, market);

/** The generated email with the market's footer appended unmodified; null when the market has no footer to append. */
export function composeDraft(generated: GeneratedEmail, market: MarketKey, unsubscribeUrl: string): GeneratedEmail | null {
  const result = appendFooter(generated.body, COMPLIANCE_CONFIG, market, unsubscribeUrl);
  return result.status === "ok" ? { subject: generated.subject, body: result.body } : null;
}

/** True when a BD's save dropped the footer of a market that needs one: warn, but do not block the save. */
export const footerRemovedOnSave = (body: string, market: MarketKey): boolean =>
  isMarketMapped(market) && !bodyHasFooter(body, COMPLIANCE_CONFIG, market);

export interface BatchResult {
  generated: string[];
  skipped: string[];
  failed: string[];
}

/**
 * One member at a time, in order, each in its own try/catch: a failure is recorded and the batch goes on. Never
 * Promise.all: the production DB pool is max 3 and the model gateway is rate limited.
 */
export async function runDraftBatch(
  memberIds: readonly string[],
  draftOne: (memberId: string) => Promise<"generated" | "skipped">,
): Promise<BatchResult> {
  const result: BatchResult = { generated: [], skipped: [], failed: [] };
  for (const id of memberIds) {
    try {
      result[(await draftOne(id)) === "generated" ? "generated" : "skipped"].push(id);
    } catch (error) {
      console.error("sequence draft failed", id, error);
      result.failed.push(id);
    }
  }
  return result;
}
