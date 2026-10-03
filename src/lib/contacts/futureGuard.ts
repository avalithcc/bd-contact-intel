/**
 * The single notion of "future" for every activity planner that records
 * something as already having happened (planCall, planMeeting). One helper so
 * the tolerance and the comparison cannot drift between planners.
 */

/** Small allowance for client/server clock skew — not a real grace window
 * for "logging something slightly ahead of time". */
export const FUTURE_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** True when `at` is more than the skew tolerance ahead of `now`. */
export function isBeyondClockSkew(at: Date, now: Date): boolean {
  return at.getTime() - now.getTime() > FUTURE_CLOCK_SKEW_TOLERANCE_MS;
}
