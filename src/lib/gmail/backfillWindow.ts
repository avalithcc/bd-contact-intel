/**
 * How far back the first-sync (and re-baseline) backfill reads, in days.
 * Kept in its own dependency-free module so the unit tests can pin the value
 * and the `after:` boundary it produces without importing the DB layer
 * (syncOneAccountNow.ts is its only consumer).
 *
 * Two years (730), up from the original 90. Judgement call, not an owner
 * figure: it covers commercially relevant history (the CEO's commercial
 * contacts export reaches back to 2020) without an unbounded fetch, and it is
 * the single constant to revisit. What 90 days bought, measured 2026-10-05
 * across the three connected accounts: 361 stored messages, 202 inbound,
 * spanning 2026-07-02 to 2026-10-05, from only 40 distinct senders. The stored
 * bodies are the corpus for extracting phone numbers from signatures, so a
 * wider window multiplies it.
 *
 * Cost: the backfill reads ONE 50-message `messages.list` page per cron turn
 * (every 2 minutes), so a mailbox of N messages in the window takes about
 * N / 50 turns, i.e. N / 25 minutes per account. The window grew ~8x, and so
 * does that time. It terminates (finite pages, resumable via
 * `backfill_page_token`), but a busy mailbox takes hours, not minutes.
 */
export const BACKFILL_WINDOW_DAYS = 730;
