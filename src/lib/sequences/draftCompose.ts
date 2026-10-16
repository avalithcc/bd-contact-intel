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

export const MAX_REASON_CHARS = 300;

// sanitizeSendError (tasks) does not fit: its base64 rule would redact the 20-char error keys ("gatewayNotConfigured")
// that make a reason useful. Here: strip auth headers, then cap.
export function batchReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, "[redacted]").slice(0, MAX_REASON_CHARS);
}

/** A hand-edited draft the server left alone: `editedAt` (epoch ms) is the instant of the text it found, which is what the BD is shown. */
export type SkippedEdit = { memberId: string; editedAt: number };
/** member id -> the `editedAt` (epoch ms) of the text the BD saw and accepted losing. Anything not listed stays protected. */
export type EditConfirmations = Readonly<Record<string, number>>;

/**
 * Regenerating replaces the row in place and nothing keeps the old text, so a hand-edited draft is overwritten only for
 * the exact text the BD confirmed: no confirmation, or an edit newer than the confirmed instant, refuses. Pure so the rule
 * is tested; draftQueries applies it inside the member-row lock, where "newer" cannot race with a save.
 */
export function blocksEditedOverwrite(mode: "missing" | "regenerate", confirmedAt: number | null | undefined, editedAt: Date | null): boolean {
  if (mode !== "regenerate" || editedAt === null) return false;
  // Fails CLOSED: only a finite number that covers the stored edit lets the overwrite through. NaN, a string, undefined,
  // Infinity and a negative all fall through to "block", because what this protects cannot be recovered.
  return !(typeof confirmedAt === "number" && Number.isFinite(confirmedAt) && editedAt.getTime() <= confirmedAt);
}

/** The trust boundary for a client-sent confirmation: keeps only entries whose value is a finite number. */
export function validConfirmations(input: unknown): EditConfirmations {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
}

export interface BatchResult {
  generated: string[];
  skipped: string[];
  failed: string[];
  /** Why each failed member failed, keyed by member id. Sanitized and capped; server-side only, never returned to the client. */
  reasons: Record<string, string>;
}

/**
 * One member at a time, in order, each in its own try/catch: a failure is recorded and the batch goes on. Never
 * Promise.all: the production DB pool is max 3 and the model gateway is rate limited.
 */
export async function runDraftBatch(
  memberIds: readonly string[],
  draftOne: (memberId: string) => Promise<"generated" | "skipped">,
): Promise<BatchResult> {
  const result: BatchResult = { generated: [], skipped: [], failed: [], reasons: {} };
  for (const id of memberIds) {
    try {
      result[(await draftOne(id)) === "generated" ? "generated" : "skipped"].push(id);
    } catch (error) {
      console.error("sequence draft failed", id, error);
      result.failed.push(id);
      result.reasons[id] = batchReason(error);
    }
  }
  return result;
}
