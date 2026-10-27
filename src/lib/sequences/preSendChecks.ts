/**
 * Every re-check the runner makes immediately before a send (sequence-scheduling "Pre-send re-checks"), in ONE pure
 * function with ONE `HoldReason` union. The first failing check wins, in a fixed order, so the reason shown to the BD
 * is stable. A held member is skipped, never counted against the cap, and never silently dropped: the runner persists
 * the reason on the member (`hold_reason`) and the UI words it.
 *
 * Two decisions encoded here:
 *  - A recipient with no compliance address (no audience: no location signal, or an embargoed jurisdiction) HOLDS as
 *    `unmapped_market`. There is no default address (config.ts). The reason code is historical: it predates the audience.
 *  - Any existing non-failed claim holds as `manual_check`: a `pending` claim is the crash case (Gmail may or may not
 *    have accepted the message) and is NEVER auto-resent; at-most-once beats at-least-once.
 * The "no genuine reply" check reads TWO facts. `repliedAt` is derived and written only by the best-effort sync hook
 * (applyReplies.ts), which is swallowed on failure so mail sync survives. `inboundReplyAt` comes from email_message, the
 * source of truth, so a hook that failed costs nothing here: the last line of defence never depends on an optional step.
 */
import type { AudienceLanguage, ComplianceAddress } from "./complianceAudience";
import { complianceRefusal, extractUnsubscribeUrl } from "./complianceGate";
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
  "wrong_language",
  "account_not_connected",
  "replied",
  "sync_stale",
  "no_thread_headers",
  // Written by the runner after a definitive Gmail refusal, not by evaluatePreSendChecks.
  "send_failed",
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

/**
 * The holds that only describe the DRAFT: its address, its footer, its language. Regenerating, editing or cancelling the approval removes
 * what they were about, so those operations clear them (draftHold.ts) and an unapproved draft card does not show them. Every other reason is
 * about the send or the recipient (an unconfirmed Gmail send, a suppression, a client company ...) and survives all of those.
 */
export const DRAFT_HOLD_REASONS: readonly HoldReason[] = ["unmapped_market", "missing_footer", "wrong_language"];

export interface PreSendFacts {
  step: 1 | 2;
  memberState: string;
  draftApproved: boolean;
  merged: boolean;
  email: string | null;
  hasClientStatus: boolean;
  /** The address the recipient's audience resolves to NOW; null = no audience, hold. Recomputed at send time, never stored. */
  address: ComplianceAddress | null;
  body: string;
  /** `sequence_draft.language` of THIS step (null = unknown, never held for it) and the language to measure it against: the resolver's for step 1, step 1's own for a reminder (languageToday). */
  draftLanguage: string | null;
  languageToday: AudienceLanguage | null;
  accountStatus: string;
  /** Outcome of the member's non-failed claim for THIS step, if any. */
  activeClaim: "pending" | "sent" | null;
  /** When that claim was taken. Unknown (null/absent) reads as stale, which holds: failing toward a manual look. */
  activeClaimAt?: Date | null;
  repliedAt: Date | null;
  /** Earliest genuine inbound message from the Contact after step 1's send, from email_message (see genuineReplyAfterSend). */
  inboundReplyAt: Date | null;
  lastSyncedAt: Date | null;
  /** Step 1's stored RFC Message-ID and Gmail thread: what a reminder threads against. */
  step1RfcMessageId: string | null;
  step1ThreadId: string | null;
}

/**
 * `skip` is not a hold: the member is left exactly as it is and nothing is written or counted. A `pending` claim younger than
 * this is a send in flight (an "Enviar ahora" a moment ago, or a tick running now), not a crash.
 */
export const IN_FLIGHT_CLAIM_MS = 5 * 60_000;

export type CheckResult = { ok: true } | { ok: false; reason: HoldReason } | { ok: false; skip: "in_flight" };

// Kept here so existing importers (releaseMessage) are untouched; the implementation lives in complianceGate.
export { extractUnsubscribeUrl };

export function evaluatePreSendChecks(
  f: PreSendFacts,
  ctx: { now: Date; suppression: readonly SuppressionRule[]; config?: ComplianceConfig; staleAfterMs?: number },
): CheckResult {
  const hold = (reason: HoldReason): CheckResult => ({ ok: false, reason });
  if (f.memberState !== (f.step === 1 ? "approved" : "sent") || !f.draftApproved) return hold("not_approved");
  if (f.activeClaim) {
    const inFlight = f.activeClaim === "pending" && f.activeClaimAt != null && ctx.now.getTime() - f.activeClaimAt.getTime() < IN_FLIGHT_CLAIM_MS;
    return inFlight ? { ok: false, skip: "in_flight" } : hold("manual_check");
  }
  if (f.merged) return hold("merged_contact");
  const email = f.email?.trim();
  if (!email) return hold("no_email");
  if (isSuppressed(email, ctx.suppression)) return hold("suppressed");
  if (f.hasClientStatus) return hold("client_company");
  const config = ctx.config ?? COMPLIANCE_CONFIG;
  const refusal = complianceRefusal(f.address, f.body, config, { draft: f.draftLanguage, today: f.languageToday });
  if (refusal) return hold(refusal);
  if (f.accountStatus !== "connected") return hold("account_not_connected");
  if (f.step === 2) {
    if (f.repliedAt || f.inboundReplyAt) return hold("replied");
    if (!isSyncFreshEnough({ lastSyncedAt: f.lastSyncedAt, now: ctx.now, staleAfterMs: ctx.staleAfterMs ?? SEQUENCE_SYNC_STALE_MS })) return hold("sync_stale");
    if (!f.step1RfcMessageId || !f.step1ThreadId) return hold("no_thread_headers");
  }
  return { ok: true };
}
