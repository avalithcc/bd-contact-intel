/**
 * Pure decision logic behind the daily task-digest cron's "abandoned claim"
 * reclaim (src/lib/tasks/digestQueries.ts's `claimDigestSend`). A
 * `task_digest_send` row stays `status = 'pending'` for as long as its
 * claiming run is actually sending; if that process dies mid-send (crash,
 * timeout, cold-start kill) before calling `markDigestSent`/`markDigestFailed`,
 * the row is stuck `pending` forever — nothing re-claims it, nothing flags
 * it, and that BD silently gets no digest that day.
 *
 * `abandonedClaimCutoff` is the SQL-side half of this decision (feeds
 * `claimDigestSend`'s reclaim `UPDATE ... WHERE created_at < cutoff`) and
 * `isAbandonedPendingClaim` is the same threshold expressed as a boolean —
 * both derive from the one exported constant so they can never drift apart.
 */

/**
 * Comfortably above the route's own `maxDuration` (60s, see
 * src/app/api/tasks/digest/route.ts) so a run that is still legitimately
 * mid-send is never reclaimed out from under it.
 */
export const ABANDONED_CLAIM_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * True once a `pending` claim is old enough that its owning run must have
 * died before finishing. Only meaningful for rows still `status =
 * 'pending'` — the caller gates on that separately: a `sent` row must never
 * be resent, and a `failed` row must never be auto-retried (a failed send
 * stays a deliberate operator retry, see `taskDigestSend`'s schema
 * comment in src/db/schema.ts).
 */
export function isAbandonedPendingClaim(
  createdAt: Date,
  now: Date,
  thresholdMs: number = ABANDONED_CLAIM_THRESHOLD_MS,
): boolean {
  return now.getTime() - createdAt.getTime() > thresholdMs;
}

/**
 * The `created_at` cutoff below which a `pending` row counts as abandoned.
 * `createdAt < abandonedClaimCutoff(now)` is exactly equivalent to
 * `isAbandonedPendingClaim(createdAt, now)` — see the boundary test in
 * tests/unit/digestClaim.test.ts.
 */
export function abandonedClaimCutoff(
  now: Date,
  thresholdMs: number = ABANDONED_CLAIM_THRESHOLD_MS,
): Date {
  return new Date(now.getTime() - thresholdMs);
}
