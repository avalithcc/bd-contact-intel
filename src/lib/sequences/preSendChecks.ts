/**
 * Every re-check the runner makes immediately before a send (sequence-scheduling "Pre-send re-checks"), in ONE pure
 * function with ONE `HoldReason` union. The first failing check wins, in a fixed order, so the reason shown to the BD
 * is stable. A held member is skipped, never counted against the cap, and never silently dropped: the runner persists
 * the reason on the member (`hold_reason`) and the UI words it.
 *
 * Two decisions encoded here:
 *  - A market with no compliance entry (`other`) HOLDS as `unmapped_market`. There is no default address (config.ts).
 *  - Any existing non-failed claim holds as `manual_check`: a `pending` claim is the crash case (Gmail may or may not
 *    have accepted the message) and is NEVER auto-resent; at-most-once beats at-least-once.
 * The "no genuine reply" check reads `repliedAt`, which only the reply handling of PR 10 writes. Until then nothing sets
 * it, which is safe only because the runner is not reachable.
 */
import type { MarketKey } from "@/lib/hiring/markets";
import { bodyHasFooter } from "./complianceFooter";
import { COMPLIANCE_CONFIG, SEQUENCE_SYNC_STALE_MS, type ComplianceConfig } from "./config";
import { isSyncFreshEnough } from "./syncFreshness";
import { isSuppressed, type SuppressionRule } from "./suppression";

export const HOLD_REASONS = [
  "not_approved",
  "manual_check",
  "merged_contact",
  "no_email",
  "suppressed",
  "client_company",
  "unmapped_market",
  "missing_footer",
  "account_not_connected",
  "replied",
  "sync_stale",
  "no_thread_headers",
  // Written by the runner after a definitive Gmail refusal, not by evaluatePreSendChecks.
  "send_failed",
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export interface PreSendFacts {
  step: 1 | 2;
  memberState: string;
  draftApproved: boolean;
  merged: boolean;
  email: string | null;
  hasClientStatus: boolean;
  market: MarketKey;
  body: string;
  accountStatus: string;
  /** Outcome of the member's non-failed claim for THIS step, if any. */
  activeClaim: "pending" | "sent" | null;
  repliedAt: Date | null;
  lastSyncedAt: Date | null;
  /** Step 1's stored RFC Message-ID and Gmail thread: what a reminder threads against. */
  step1RfcMessageId: string | null;
  step1ThreadId: string | null;
}

export type CheckResult = { ok: true } | { ok: false; reason: HoldReason };

const UNSUBSCRIBE_LINK = /https:\/\/[^\s<>,"]+\/api\/unsubscribe\?t=[A-Za-z0-9_-]{43}/;

/** The per-recipient link the footer producer wrote into the body; null when the BD edited it away. */
export function extractUnsubscribeUrl(body: string): string | null {
  return body.match(UNSUBSCRIBE_LINK)?.[0] ?? null;
}

export function evaluatePreSendChecks(
  f: PreSendFacts,
  ctx: { now: Date; suppression: readonly SuppressionRule[]; config?: ComplianceConfig; staleAfterMs?: number },
): CheckResult {
  const hold = (reason: HoldReason): CheckResult => ({ ok: false, reason });
  if (f.memberState !== (f.step === 1 ? "approved" : "sent") || !f.draftApproved) return hold("not_approved");
  if (f.activeClaim) return hold("manual_check");
  if (f.merged) return hold("merged_contact");
  const email = f.email?.trim();
  if (!email) return hold("no_email");
  if (isSuppressed(email, ctx.suppression)) return hold("suppressed");
  if (f.hasClientStatus) return hold("client_company");
  const config = ctx.config ?? COMPLIANCE_CONFIG;
  if (!Object.hasOwn(config, f.market)) return hold("unmapped_market");
  if (!bodyHasFooter(f.body, config, f.market) || !extractUnsubscribeUrl(f.body)) return hold("missing_footer");
  if (f.accountStatus !== "connected") return hold("account_not_connected");
  if (f.step === 2) {
    if (f.repliedAt) return hold("replied");
    if (!isSyncFreshEnough({ lastSyncedAt: f.lastSyncedAt, now: ctx.now, staleAfterMs: ctx.staleAfterMs ?? SEQUENCE_SYNC_STALE_MS })) return hold("sync_stale");
    if (!f.step1RfcMessageId || !f.step1ThreadId) return hold("no_thread_headers");
  }
  return { ok: true };
}
