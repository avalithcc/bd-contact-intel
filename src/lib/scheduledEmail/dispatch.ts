/**
 * The dispatcher's orchestration, with every side effect injected (tests pass the real queries and a fake sender).
 *
 * CRASH TRADEOFF (owner-visible): a row is claimed ('sending') BEFORE Gmail is called, so delivery is AT MOST ONCE. If the
 * process dies after Gmail accepted the message but before `markSent`, the row stays 'sending'; no run ever claims a
 * 'sending' row, and after STALE_SENDING_MS the sweep turns it into 'failed' / outcome_unknown so the BD checks Sent and
 * decides. The price is that a crash can leave a message unsent (surfaced, never silent); the alternative (re-claim stale
 * rows) would eventually email a prospect twice, which cannot be undone. The same rule means a transient Gmail error is
 * not retried: a 5xx can arrive after Gmail accepted the message.
 */
import { GmailSendError } from "@/lib/gmail/errors";
import { isSuppressed, type SuppressionRule } from "@/lib/sequences/suppression";
import { BATCH_SIZE } from "./plan";
import type { ClaimedEmail } from "./queries";

export interface RunDeps {
  holdReplied(): Promise<number>;
  claimDue(limit: number): Promise<ClaimedEmail[]>;
  countDue(): Promise<number>;
  sweepStale(): Promise<number>;
  send(row: ClaimedEmail): Promise<{ messageId: string }>;
  markSent(id: string, gmailMessageId: string): Promise<void>;
  markFailed(id: string, code: string): Promise<void>;
  /** Company-wide opt-outs (email_suppression), read once per run and only when something was claimed. */
  loadSuppression(): Promise<SuppressionRule[]>;
  /** 'sending' -> 'cancelled' with a fixed reason code; only valid BEFORE Gmail is called. */
  markCancelled(id: string, code: string): Promise<void>;
}

export const SUPPRESSED_CODE = "recipient_suppressed";

export interface RunSummary {
  dryRun: boolean;
  due: number;
  held: number;
  sent: number;
  failed: number;
  /** Cancelled at the last moment because the recipient is suppressed (opted out). */
  cancelled: number;
  /** Sent, but recording it failed: the row is left as is (markSent also heals a swept row). */
  unrecorded: number;
  swept: number;
}

/** Fixed, UI-mappable codes. Never the raw error: Gmail's response body can carry addresses and tokens. */
export function failureCode(err: unknown): string {
  if (err instanceof GmailSendError) {
    if (err.kind === "not_connected" || err.kind === "reauth_required") return "gmail_not_connected";
    if (err.kind !== "send_failed" || (err.status !== undefined && err.status < 500)) return "gmail_unavailable"; // provably not sent
  }
  return "outcome_unknown"; // 5xx, network, or a failure after Gmail may have accepted it
}

export async function dispatchScheduledEmails(deps: RunDeps, opts: { dryRun: boolean }): Promise<RunSummary> {
  if (opts.dryRun) return { dryRun: true, due: await deps.countDue(), held: 0, sent: 0, failed: 0, cancelled: 0, unrecorded: 0, swept: 0 };
  const swept = await deps.sweepStale();
  const held = await deps.holdReplied();
  const rows = await deps.claimDue(BATCH_SIZE);
  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  let unrecorded = 0;
  // Last-moment opt-out check, right before Gmail. If the list cannot be read we fail CLOSED (never send blind):
  // the rows are failed with a provably-unsent code so the BD can resend.
  let rules: SuppressionRule[] | null = null;
  if (rows.length) {
    try {
      rules = await deps.loadSuppression();
    } catch (err) {
      console.error("[scheduled-email] suppression list unavailable", err);
    }
  }
  for (const row of rows) {
    if (!rules) {
      await deps.markFailed(row.id, "gmail_unavailable");
      failed++;
      continue;
    }
    if (isSuppressed(row.toAddress, rules)) {
      await deps.markCancelled(row.id, SUPPRESSED_CODE);
      cancelled++;
      continue;
    }
    let messageId: string;
    try {
      ({ messageId } = await deps.send(row));
    } catch (err) {
      await deps.markFailed(row.id, failureCode(err));
      failed++;
      continue;
    }
    // The mail is out. A bookkeeping error must never turn into markFailed: that would show a sent mail as unsent.
    try {
      await deps.markSent(row.id, messageId);
      sent++;
    } catch (err) {
      unrecorded++;
      console.error("[scheduled-email] sent but not recorded", row.id, messageId, err);
    }
  }
  return { dryRun: false, due: rows.length, held, sent, failed, cancelled, unrecorded, swept };
}
