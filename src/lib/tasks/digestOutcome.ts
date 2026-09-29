/**
 * Pure decision behind the daily task-digest cron route's HTTP status
 * (src/app/api/tasks/digest/route.ts). Vercel's cron monitoring only flags a
 * run as failed when the response status is non-2xx, so the route must
 * return e.g. 500 whenever at least one BD's send actually failed — a send
 * that fails after reclaiming an abandoned `pending` row (digestClaim.ts)
 * is reported the same way, since it carries the same `send_failed` skip
 * reason as a fresh claim's failure.
 */

export interface DigestOutcomeResult {
  skippedReason?: "no_open_tasks_due" | "dry_run" | "already_claimed" | "send_failed";
}

/**
 * True when at least one BD's send failed this run — never true for a dry
 * run (nothing was attempted) or for "no open tasks"/"already claimed"
 * skips, neither of which is a failure.
 */
export function digestRunHasFailure(results: readonly DigestOutcomeResult[]): boolean {
  return results.some((r) => r.skippedReason === "send_failed");
}
