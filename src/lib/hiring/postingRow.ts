import type { MarketKey } from "@/lib/hiring/markets";

// Pure row-shape helpers for job_posting reads. Deliberately has no
// dependency on "@/db" (unlike src/lib/hiring/queries.ts) so it can be unit
// tested without a DATABASE_URL — see tests/unit/hiringPostingRow.test.ts.

export interface OpenPosting {
  id: string;
  title: string;
  location: string;
  market: MarketKey;
  url: string;
  postedAt: Date | null;
  firstSeen: Date;
}

/** Raw shape of one job_posting row as selected by both
 * resolveHiringCompanies (the whole-map path) and getCompanyPostingsForKey
 * (the single-company scoped path) in src/lib/hiring/queries.ts — kept in
 * sync here so both callers map a row into an OpenPosting the same way. */
export interface OpenPostingRow {
  id: string;
  title: string;
  location: string;
  // Rows synced before the market column was backfilled are null; treat
  // those as "other" rather than crashing the UI on an unclassified value
  // (see scripts/backfill-posting-markets.ts).
  market: string | null;
  url: string;
  postedAt: Date | null;
  firstSeen: Date;
}

export function toOpenPosting(row: OpenPostingRow): OpenPosting {
  return {
    id: row.id,
    title: row.title,
    location: row.location,
    market: (row.market as MarketKey | null) ?? "other",
    url: row.url,
    postedAt: row.postedAt,
    firstSeen: row.firstSeen,
  };
}

/**
 * Reduces the result of the "does this key resolve to a target company"
 * lookup used by getCompanyPostingsForKey's scoped path (a UNION of
 * `target_company.company_key = key` and `company_alias.alias_key = key`,
 * see queries.ts) to the canonical company_key, or null when the key
 * matches neither table.
 */
export function resolveCanonicalCompanyKey(
  rows: Array<{ company_key: string }>,
): string | null {
  return rows[0]?.company_key ?? null;
}
