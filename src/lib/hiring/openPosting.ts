/**
 * THE definition of a job posting that "counts" as a live hiring signal: it is OPEN (`closed_at is null`) AND was
 * posted within the last `FRESH_POSTING_WINDOW_DAYS` days. Every read that counts, lists, exports, badges or gates on
 * open postings (Vacantes, contact/company counts, dashboard, Sequence eligibility) goes through this module, the
 * same way `effectiveActivityAtSql` is the one rule for activity time. Do not hand-write `closed_at is null` anywhere
 * else (tests/unit/hiringOpenPosting.test.ts fails if you do): the copies drift apart and the surfaces disagree.
 *
 * Why: "open" alone kept a req published in 2022 and never closed (e.g. seven from one staffing partner still listed
 * by SmartRecruiters) as a live signal. Owner decision, measured on prod: open postings 11,095 -> 7,478, companies with
 * an open posting 215 -> 168, companies with an open US IT posting (the Sequences pool) 83 -> 59. Quality over volume.
 *
 * Freshness is `coalesce(posted_at, first_seen)`. `posted_at` is nullable (a future ATS may send none); hiding those
 * silently would be worse than showing them, so we fall back to `first_seen`, the moment our sync first saw the row,
 * which is a real lower bound on its age for anything discovered after we started scraping.
 *
 * Caveat, accepted by the owner: `posted_at` does not mean the same thing across providers. Greenhouse sends
 * `updated_at` (best-effort, see greenhouse.ts), Lever `createdAt`, Ashby `publishedAt`, Recruitee `published_at`. So
 * the window measures "last edited" on Greenhouse and "originally published" elsewhere, and bites harder on Lever and
 * Ashby. Measured share of open postings kept within 30 days: Greenhouse 80%, SmartRecruiters 54%, Ashby 37%,
 * Lever 34%. This is not a bug.
 *
 * `is_it` and `market` are deliberately NOT part of this rule; callers add them (draftQueries aggregates markets and
 * does not filter `market = 'us'`, the roster does).
 */
import { sql, type SQL } from "drizzle-orm";
import { jobPosting } from "@/db/schema";

export const FRESH_POSTING_WINDOW_DAYS = 30;

const open = (closedAt: SQL) => sql`${closedAt} is null`;
const fresh = (closedAt: SQL, postedAt: SQL, firstSeen: SQL) =>
  sql`(${open(closedAt)} and coalesce(${postedAt}, ${firstSeen}) >= now() - interval '${sql.raw(String(FRESH_POSTING_WINDOW_DAYS))} days')`;
const safeAlias = (alias: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`invalid SQL alias: ${alias}`);
  return (name: string) => sql.raw(`${alias}.${name}`);
};

/** "Is this company hiring right now?" Raw-SQL form for a `job_posting` aliased `alias` (`jp`, `jp2`, ...). */
export function openFreshPostingSql(alias = "jp"): SQL {
  const col = safeAlias(alias);
  return fresh(col("closed_at"), col("posted_at"), col("first_seen"));
}

/**
 * OPEN only, NO freshness window. Use it ONLY for geography/compliance questions ("where is this recipient?", i.e.
 * the `posting_markets` that feed recipientMarket), never for hiring signals. The two questions differ: a 60-day-old
 * open posting no longer proves the company is hot, but it still says the person is in the US, and a Sequence member
 * seeded on a fresh posting must not lose its market (and get an invisible `other` hold) the day that posting ages out.
 */
export function openPostingSql(alias = "jp"): SQL {
  return open(safeAlias(alias)("closed_at"));
}

/** Drizzle-builder twin over the typed `job_posting` columns; same rule, same text. */
export function openFreshPostingCondition(): SQL {
  return fresh(sql`${jobPosting.closedAt}`, sql`${jobPosting.postedAt}`, sql`${jobPosting.firstSeen}`);
}
