/**
 * The pure half of the `job_posting.market` / `is_miami` recompute (scripts/backfill-posting-markets.ts): which stored rows
 * disagree with today's classifier, and the audit row that lets the run be reverted. No I/O, and nothing it is given is
 * mutated, so a dry run and the run that follows it plan the same thing from the same rows.
 *
 * Why a recompute is needed at all: sync.ts upserts `market` and `is_miami` from `excluded`, but only for postings the ATS feed
 * still returns. Closed postings are never re-upserted, so a rules edit leaves them on the old rules until this runs.
 */
import { classifyMarket, isMiamiArea, type MarketKey } from "./markets";

export interface PostingMarketRow {
  id: string;
  location: string | null;
  market: string | null;
  isMiami: boolean;
}

export interface PostingMarketChange {
  id: string;
  fromMarket: string | null;
  toMarket: MarketKey;
  fromMiami: boolean;
  toMiami: boolean;
}

/** Audit action of the one row written by `--execute`. */
export const MARKET_BACKFILL_ACTION = "posting_market_backfill";
/** The audit row carries every previous value (the revert path), so a run larger than this must be paginated first. */
export const MAX_AUDITED_CHANGES = 5000;

export function planPostingMarketChanges(rows: readonly PostingMarketRow[]): PostingMarketChange[] {
  const changes: PostingMarketChange[] = [];
  for (const row of rows) {
    const toMarket = classifyMarket(row.location);
    const toMiami = isMiamiArea(row.location);
    if (toMarket !== row.market || toMiami !== row.isMiami) {
      changes.push({ id: row.id, fromMarket: row.market, toMarket, fromMiami: row.isMiami, toMiami });
    }
  }
  return changes;
}

/** Counts only: `"latam>us": 191`, plus the number of rows whose Florida flag flips. */
export function summarizePostingMarketChanges(changes: readonly PostingMarketChange[]) {
  const byTransition: Record<string, number> = {};
  let miamiFlips = 0;
  for (const c of changes) {
    const key = `${c.fromMarket ?? "null"}>${c.toMarket}`;
    if (c.fromMarket !== c.toMarket) byTransition[key] = (byTransition[key] ?? 0) + 1;
    if (c.fromMiami !== c.toMiami) miamiFlips += 1;
  }
  return { changed: changes.length, byTransition, miamiFlips };
}

/**
 * Metadata of the audit row. `previous` is the revert path: put every row back to its old values with
 *   update job_posting jp set market = c->>'market', is_miami = (c->>'isMiami')::boolean
 *   from audit_log a, jsonb_array_elements(a.metadata->'previous') c
 *   where a.id = '<audit id>' and jp.id = (c->>'id')::uuid;
 * Ids and market keys only: no names, emails or location text.
 */
export function buildMarketBackfillAuditMetadata(scanned: number, changes: readonly PostingMarketChange[]) {
  if (changes.length > MAX_AUDITED_CHANGES) {
    throw new Error(`refusing to audit ${changes.length} changes (> ${MAX_AUDITED_CHANGES}): the revert path would not fit one row`);
  }
  return {
    scanned,
    ...summarizePostingMarketChanges(changes),
    previous: changes.map((c) => ({ id: c.id, market: c.fromMarket, isMiami: c.fromMiami })),
  };
}
