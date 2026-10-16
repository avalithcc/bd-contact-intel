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
 * Freshness is `least(posted_at, first_seen)`: the EARLIEST evidence we have of the posting's age. Postgres `least`
 * ignores NULLs, so a missing `posted_at` (a future ATS may send none) falls back to `first_seen`, the moment our
 * sync first saw the row, exactly what the old `coalesce` did; hiding those silently would be worse than showing them.
 *
 * Why `least` and not `posted_at` first: `posted_at` is not stable across providers. Greenhouse sends `updated_at`
 * (best-effort, see greenhouse.ts), Lever `createdAt`, Ashby `publishedAt`, Recruitee `published_at`, and sync.ts
 * overwrites `posted_at` with `excluded.posted_at` on every conflict. So editing a Greenhouse req pushes its date
 * forward and an aged-out req (published in 2022, first seen last month) would re-enter the window and show as hot.
 * The owner decided that must not happen: only genuinely new open jobs count. An edit can only make `posted_at` LATER
 * than the truth, never earlier, and `first_seen` never mutates, so taking the earlier of the two is immune to it:
 * published 2022 and edited today stays OUT; published today and first seen today stays IN; published 10 days ago but
 * first seen 60 days ago (possible only through an edit, we cannot see a posting before it exists) is OUT.
 * Known limit: the window still measures "originally published" on Lever and Ashby and bites harder there (measured
 * share of open postings kept within 30 days before this change: Greenhouse 80%, SmartRecruiters 54%, Ashby 37%,
 * Lever 34%; Greenhouse drops now that its edits no longer count). This is not a bug.
 *
 * The 7-day delta baseline below uses the same `least` basis at the earlier instant, so today's total and the
 * baseline share one definition of age.
 *
 * `is_it` and `market` are deliberately NOT part of this rule; callers add them (draftQueries aggregates markets and
 * does not filter `market = 'us'`, the roster does).
 */
import { sql, type SQL } from "drizzle-orm";
import { jobPosting } from "@/db/schema";

export const FRESH_POSTING_WINDOW_DAYS = 30;
/** Length of the "what changed" window shown next to the vacancy count on the Vacantes screen. */
export const POSTING_DELTA_WINDOW_DAYS = 7;

const days = (n: number) => sql.raw(`interval '${n} days'`);
/** The one freshness basis: the earliest of when it was published and when we first saw it (NULLs ignored). */
const basis = (postedAt: SQL, firstSeen: SQL) => sql`least(${postedAt}, ${firstSeen})`;
const open = (closedAt: SQL) => sql`${closedAt} is null`;
const fresh = (closedAt: SQL, postedAt: SQL, firstSeen: SQL) =>
  sql`(${open(closedAt)} and ${basis(postedAt, firstSeen)} >= now() - ${days(FRESH_POSTING_WINDOW_DAYS)})`;
// The same rule evaluated at the instant `POSTING_DELTA_WINDOW_DAYS` ago: not yet closed as of then, already in OUR
// data as of then (`first_seen`: a posting we had not scraped yet was not in our total, whatever its publish date),
// and inside the freshness window as of then. Today's counted total minus this count is the delta, so closures,
// postings aging out of the window and new postings all fall out of ONE definition.
// Existence comes from `first_seen` only, never from `posted_at`: `posted_at` moves when a Greenhouse req is edited
// (see the caveat above), and a req we have held for 30 days must not read as newly opened because it was touched.
// For the same reason the age at that instant is `least(posted_at, first_seen)`, the earliest evidence we have: an
// edit can only make `posted_at` later than the truth, never earlier, and `first_seen` is a floor on the age.
// On the day we start tracking a company every posting is new to us, so it reads as a rise: that is correct.
const countedBeforeDeltaWindow = (closedAt: SQL, postedAt: SQL, firstSeen: SQL) =>
  sql`((${open(closedAt)} or ${closedAt} > now() - ${days(POSTING_DELTA_WINDOW_DAYS)}) and ${firstSeen} <= now() - ${days(POSTING_DELTA_WINDOW_DAYS)} and least(${postedAt}, ${firstSeen}) >= now() - ${days(POSTING_DELTA_WINDOW_DAYS + FRESH_POSTING_WINDOW_DAYS)})`;
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

/** "Would this posting have counted `POSTING_DELTA_WINDOW_DAYS` ago?" Raw-SQL form; the baseline of the 7-day delta. */
export function countedBeforeDeltaWindowSql(alias = "jp"): SQL {
  const col = safeAlias(alias);
  return countedBeforeDeltaWindow(col("closed_at"), col("posted_at"), col("first_seen"));
}
