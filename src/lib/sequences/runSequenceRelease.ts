/**
 * The release runner: read -> pre-send checks -> plan -> (claim -> send -> record) per member. Every effect goes through
 * an injected port (the `runCatchUpExecute` pattern: src/lib/migration/catchUpRun.ts), so the ordering guarantees below
 * are tested with fakes and the real ports live in releaseQueries.ts.
 *
 * LIBRARY CODE ONLY. Nothing under src/app imports this file or releaseQueries.ts until PR 13 adds the route and the
 * cron (tests/unit/sequencesInert.test.ts enforces it). Two independent guarantees keep the feature inert before then,
 * and NEITHER alone is enough: (1) nothing invokes the runner; (2) it only ever releases members in `approved` (step 1)
 * or `sent` with an approved reminder (step 2), which the candidate read and preSendChecks both require.
 *
 * Order of work, and why:
 *  - Checks run BEFORE the plan, so a held member never takes a slot of the cap (it would otherwise displace a sendable
 *    one). Held members get their reason persisted; deferred members (over budget) get NOTHING written.
 *  - The claim is taken BEFORE the Gmail call and the runner proceeds only if its own insert returned a row. That is
 *    the only thing between a crash and a double send.
 *  - A GmailSendError raised before Gmail was reached, or a 4xx refusal, is a definitive "not sent": the claim is
 *    marked `failed` and a later run may claim again. A Gmail 5xx, ANY OTHER error (a dropped connection, a failure
 *    recording the send) and a failure while freeing the claim are ambiguous: the claim stays `pending` and the member
 *    is flagged `manual_check`, never resent.
 *  - One member's unexpected error never aborts the run: it becomes a manual_check hold and the loop continues.
 *  - `reauth_required` / `not_connected` halt that ACCOUNT for the run (its remaining members stay `approved`, counted as
 *    deferred); `temporary` / `send_failed` only fail that member. Each member is attempted at most once per run.
 *  - Contact status is not touched here: the send port records the `email_sent` activity and status derives from it
 *    (deriveStatus). Nothing in this module sets a status.
 */
import { GmailSendError, type GmailSendErrorKind } from "@/lib/gmail/errors";
import { buildReleaseMessage, type ReleaseMessage, type ReleaseMessageFacts } from "./releaseMessage";
import { planSequenceRelease, type PlanCandidate } from "./releasePlan";
import { evaluatePreSendChecks, type HoldReason, type PreSendFacts } from "./preSendChecks";
import type { Schedule } from "./schedule";
import type { SuppressionRule } from "./suppression";

export interface ReleaseCandidate extends PlanCandidate, PreSendFacts, ReleaseMessageFacts {
  ownerBdId: string;
  holdReason: HoldReason | null;
  schedule: Schedule;
}

export interface HoldChange {
  memberId: string;
  /** The state the candidate was read in: the write is conditional on it, so a stale hold can never land on a sent member. */
  state: string;
  reason: HoldReason | null;
}

export interface RunnerPorts {
  now(): Date;
  load(now: Date): Promise<{ candidates: ReleaseCandidate[]; sentToday: Map<string, number>; suppression: SuppressionRule[] }>;
  setHolds(changes: HoldChange[]): Promise<void>;
  /** INSERT ... ON CONFLICT DO NOTHING: the claim id, or null when the step is already claimed (or no longer approved). */
  claim(c: ReleaseCandidate): Promise<string | null>;
  send(c: ReleaseCandidate, message: ReleaseMessage): Promise<{ messageId: string; threadId: string }>;
  failClaim(claimId: string, error: string): Promise<void>;
  /** One transaction: claim -> sent (+ miami_send_date), member transition, reminderDueAt for step 1. */
  recordSent(c: ReleaseCandidate, claimId: string, sent: { messageId: string; threadId: string }, sentAt: Date): Promise<void>;
  draftReminder(c: ReleaseCandidate): Promise<void>;
}

export interface RunSummary {
  released: number;
  held: number;
  deferred: number;
  failed: number;
}

/**
 * Only a refusal Gmail could not have acted on frees the claim. Everything raised before the Gmail call (token refresh,
 * not connected, bad header) is definitive; once Gmail answered, only a 4xx is (400, 403, 429 ...). A 5xx can arrive
 * AFTER the message was accepted, and a send_failed with no status is unknown: both are treated as "may have sent".
 */
function isDefinitiveRefusal(error: GmailSendError): boolean {
  return error.kind !== "send_failed" || (error.status !== undefined && error.status >= 400 && error.status < 500);
}

const HALTS_ACCOUNT: readonly GmailSendErrorKind[] = ["reauth_required", "not_connected"];

export async function runSequenceRelease(ports: RunnerPorts): Promise<RunSummary> {
  const now = ports.now();
  const { candidates, sentToday, suppression } = await ports.load(now);
  const summary: RunSummary = { released: 0, held: 0, deferred: 0, failed: 0 };
  const eligible: ReleaseCandidate[] = [];
  const holds: HoldChange[] = [];
  const hold = (c: ReleaseCandidate, reason: HoldReason | null) => {
    if (c.holdReason !== reason) holds.push({ memberId: c.id, state: c.memberState, reason });
  };

  for (const c of candidates) {
    if (c.dueAt.getTime() > now.getTime()) continue;
    const result = evaluatePreSendChecks(c, { now, suppression });
    if (result.ok) {
      eligible.push(c);
      hold(c, null);
      continue;
    }
    summary.held++;
    // A member that is no longer approved is not an approved card any more: there is nothing to annotate.
    if (result.reason !== "not_approved") hold(c, result.reason);
  }
  if (holds.length) await ports.setHolds(holds.splice(0));

  const plan = planSequenceRelease({ now, candidates: eligible, sentToday });
  summary.deferred = plan.deferred.length;
  const halted = new Set<string>();

  for (const c of plan.release) {
    if (halted.has(c.accountId)) {
      summary.deferred++;
      continue;
    }
    // One member's failure must never abort the run or discard the holds gathered so far: an unexpected error becomes a
    // manual_check hold (we cannot know how far it got) and the loop moves on. The claim, if it landed, stays pending.
    try {
      let message: ReleaseMessage;
      try {
        message = buildReleaseMessage(c);
      } catch {
        summary.failed++;
        hold(c, "send_failed");
        continue;
      }
      const claimId = await ports.claim(c);
      if (!claimId) continue;

      let sent: { messageId: string; threadId: string };
      try {
        sent = await ports.send(c, message);
      } catch (error) {
        if (error instanceof GmailSendError && isDefinitiveRefusal(error)) {
          const stops = HALTS_ACCOUNT.includes(error.kind);
          if (stops) halted.add(c.accountId);
          // If this write throws the claim stays pending, which is the safe outcome (handled by the outer catch).
          await ports.failClaim(claimId, error.message.slice(0, 300));
          hold(c, stops ? "account_not_connected" : "send_failed");
        } else {
          hold(c, "manual_check");
        }
        summary.failed++;
        continue;
      }
      try {
        await ports.recordSent(c, claimId, sent, ports.now());
      } catch {
        summary.failed++;
        hold(c, "manual_check");
        continue;
      }
      summary.released++;
      if (c.step === 1) {
        try {
          await ports.draftReminder(c);
        } catch (error) {
          console.error(`reminder draft failed for member ${c.id}`, error instanceof Error ? error.message : error);
        }
      }
    } catch {
      summary.failed++;
      hold(c, "manual_check");
    }
  }
  if (holds.length) await ports.setHolds(holds);
  return summary;
}
