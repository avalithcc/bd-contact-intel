/**
 * Pure planner for src/lib/gmail/rfcBackfillRun.ts (shared by scripts/backfill-rfc-message-ids.ts and the admin page). Messages synced
 * before migration 0036 have no `rfc_message_id`, so they cannot be replied
 * to as a real thread reply. The runner re-reads those messages from Gmail;
 * this turns the result into the exact updates to write.
 *
 * `fetched` is keyed by `backfillKey(bdId, gmailMessageId)` — the ONE key
 * builder, used by the runner that fills the map and by this planner that
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

/** Per-run bound for the admin action: ~one sequential Gmail read per row must fit well inside the function timeout. */
export const ADMIN_BACKFILL_DEFAULT_LIMIT = 100;
export const ADMIN_BACKFILL_MAX_LIMIT = 500;

/** Server-side clamp for a client-sent limit: junk falls back to the default, anything above the maximum is capped. */
export function clampRfcBackfillLimit(
  raw: unknown,
  fallback: number = ADMIN_BACKFILL_DEFAULT_LIMIT,
  max: number = ADMIN_BACKFILL_MAX_LIMIT,
): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (Number.isNaN(n)) return fallback;
  const whole = Math.floor(n);
  if (whole < 1) return fallback;
  return Math.min(whole, max);
}

/** Groups candidates per BD, preserving input order. Builds new arrays; the input is never mutated. */
export function groupCandidatesByBd(candidates: readonly BackfillCandidate[]): Map<string, BackfillCandidate[]> {
  const perBd = new Map<string, BackfillCandidate[]>();
  for (const c of candidates) {
    const rows = perBd.get(c.bdId);
    if (rows) rows.push(c);
    else perBd.set(c.bdId, [c]);
  }
  return perBd;
}

/** Coarse, token-free reasons a BD's mailbox was skipped. */
export type BdSkipReason = "no_account" | "token_refresh_failed" | "fetch_failed";

export function tallySkipReasons(reasons: readonly BdSkipReason[]): Record<BdSkipReason, number> {
  const tally: Record<BdSkipReason, number> = { no_account: 0, token_refresh_failed: 0, fetch_failed: 0 };
  for (const r of reasons) tally[r]++;
  return tally;
}

export interface RfcBackfillSummary {
  updated: number;
  notFoundInGmail: number;
  noMessageIdHeader: number;
  skippedBds: number;
}

/** The admin action redirects with the run summary in the query string; this is the ONE producer of those keys. */
export function rfcBackfillResultToParams(result: {
  counts: BackfillPlan["counts"];
  skippedBds: number;
  updated: number;
}): URLSearchParams {
  return new URLSearchParams({
    ran: "1",
    updated: String(result.updated),
    notFound: String(result.counts.notFoundInGmail),
    noHeader: String(result.counts.noMessageIdHeader),
    skippedBds: String(result.skippedBds),
  });
}

function count(v: string | string[] | undefined): number {
  return typeof v === "string" && /^\d{1,6}$/.test(v) ? Number(v) : 0;
}

/** Reader of `rfcBackfillResultToParams`; query strings are user-editable, so every value is re-validated. */
export function parseRfcBackfillResultParams(
  params: Record<string, string | string[] | undefined>,
): RfcBackfillSummary | null {
  if (params.ran !== "1") return null;
  return {
    updated: count(params.updated),
    notFoundInGmail: count(params.notFound),
    noMessageIdHeader: count(params.noHeader),
    skippedBds: count(params.skippedBds),
  };
}
