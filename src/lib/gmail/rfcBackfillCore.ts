/**
 * Orchestration of the Message-ID backfill with every side effect injected
 * (database, crypto, token refresh, Gmail, logging), so it is unit-testable
 * without a database or network. rfcBackfillRun.ts wires the real
 * dependencies.
 */
import type { ParsedGmailMessage } from "./parseMessage";
import {
  backfillKey,
  groupCandidatesByBd,
  planRfcBackfill,
  tallySkipReasons,
  type BackfillCandidate,
  type BackfillUpdate,
  type BdSkipReason,
  type RfcBackfillCounts,
} from "./rfcBackfill";

export const BACKFILL_BATCH_SIZE = 200;

export interface RfcBackfillDeps {
  selectCandidates(limit: number): Promise<BackfillCandidate[]>;
  loadAccount(bdId: string): Promise<{ connected: boolean; refreshTokenEncrypted: string | null } | null>;
  decryptToken(encrypted: string): string;
  /** `kind` is the coarse classification only; never an error body. */
  refreshAccessToken(refreshToken: string): Promise<{ ok: true; accessToken: string } | { ok: false; kind: string }>;
  /** Returns a reader of one message by Gmail id (null when Gmail no longer has it). */
  openMailbox(accessToken: string): (gmailMessageId: string) => Promise<ParsedGmailMessage | null>;
  /**
   * Runs every batch plus ONE audit row in a single transaction and returns
   * the ids of the rows the UPDATE actually changed. `buildAuditMetadata` is
   * called with those ids.
   */
  writeUpdates(
    batches: BackfillUpdate[][],
    buildAuditMetadata: (updatedIds: string[]) => Record<string, unknown>,
  ): Promise<string[]>;
  logError(line: string): void;
}

export interface RfcBackfillResult {
  counts: RfcBackfillCounts;
  skippedBds: number;
  skipReasons: Record<BdSkipReason, number>;
  updated: number;
}

type BdFetch = { ok: true; fetched: Map<string, ParsedGmailMessage> } | { ok: false; reason: BdSkipReason };

/**
 * Gmail client errors read `<call> failed: <status> <response body>`. For the
 * fetch stage only that status prefix is logged, never the body; an
 * unrecognised message is withheld entirely.
 */
function describeError(err: unknown, stage: BdSkipReason): string {
  if (!(err instanceof Error)) return "non-Error thrown";
  const message =
    stage === "fetch_failed" ? (err.message.match(/^[\w.]+(?: [\w.]+)*? failed: \d{3}/)?.[0] ?? "(message withheld)") : err.message.slice(0, 300);
  return `${err.constructor.name}: ${message}`;
}

/**
 * One BD's account lookup + token decrypt + refresh + Gmail reads. Any failure
 * becomes a coarse reason (`stage` is set right before each step, so it names
 * the step that really failed) and one log line with the error's class and
 * message; token material and response bodies are never logged. A BD is
 * all-or-nothing: a partial fetch is discarded and retried on the next run.
 */
async function fetchForBd(deps: RfcBackfillDeps, bdId: string, rows: readonly BackfillCandidate[]): Promise<BdFetch> {
  let stage: BdSkipReason = "account_lookup_failed";
  try {
    const account = await deps.loadAccount(bdId);
    if (!account || !account.connected || !account.refreshTokenEncrypted) return { ok: false, reason: "no_account" };
    stage = "token_decrypt_failed";
    const refreshToken = deps.decryptToken(account.refreshTokenEncrypted);
    stage = "token_refresh_failed";
    const token = await deps.refreshAccessToken(refreshToken);
    if (!token.ok) {
      deps.logError(`[rfc-backfill] bd=${bdId} stage=${stage} classification=${token.kind}`);
      return { ok: false, reason: stage };
    }
    stage = "fetch_failed";
    const read = deps.openMailbox(token.accessToken);
    const fetched = new Map<string, ParsedGmailMessage>();
    for (const row of rows) {
      const message = await read(row.gmailMessageId);
      if (message) fetched.set(backfillKey(row.bdId, row.gmailMessageId), message);
    }
    return { ok: true, fetched };
  } catch (err) {
    deps.logError(`[rfc-backfill] bd=${bdId} stage=${stage} ${describeError(err, stage)}`);
    return { ok: false, reason: stage };
  }
}

export async function executeRfcBackfill(
  deps: RfcBackfillDeps,
  { limit }: { limit: number },
): Promise<RfcBackfillResult> {
  const candidates = await deps.selectCandidates(limit);
  const perBd = groupCandidatesByBd(candidates);

  const fetched = new Map<string, ParsedGmailMessage>();
  const skips: BdSkipReason[] = [];
  const plannable: BackfillCandidate[] = [];
  let skippedBdRows = 0;
  for (const [bdId, rows] of perBd) {
    const result = await fetchForBd(deps, bdId, rows);
    if (result.ok) {
      for (const [k, v] of result.fetched) fetched.set(k, v);
      plannable.push(...rows);
    } else {
      skips.push(result.reason);
      skippedBdRows += rows.length;
    }
  }

  // Skipped BDs' rows never reach the planner, so "not found in Gmail" means only that.
  const plan = planRfcBackfill(plannable, fetched);
  const counts: RfcBackfillCounts = { ...plan.counts, candidates: candidates.length, skippedBdRows };
  const skippedBds = skips.length;
  const skipReasons = tallySkipReasons(skips);
  if (plan.updates.length === 0) return { counts, skippedBds, skipReasons, updated: 0 };

  const batches: BackfillUpdate[][] = [];
  for (let i = 0; i < plan.updates.length; i += BACKFILL_BATCH_SIZE) batches.push(plan.updates.slice(i, i + BACKFILL_BATCH_SIZE));
  const updatedIds = await deps.writeUpdates(batches, (ids) => ({ counts, skippedBds, skipReasons, updated: ids.length, updatedIds: ids }));
  return { counts, skippedBds, skipReasons, updated: updatedIds.length };
}
