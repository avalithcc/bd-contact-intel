/**
 * Pure guards for the call outcome bar's async replies. Each server call takes
 * a while; the user may dismiss the bar or leave the page before it returns.
 */

/** A failed save may put the bar back only if it is still the open one. */
export function mayRestoreBar(openAttemptId: string | null, attemptId: string): boolean {
  return openAttemptId === attemptId;
}

/** A recorded attempt may open its bar only on the page where the dial happened. */
export function mayOpenBar(pathnameAtDial: string, pathnameNow: string): boolean {
  return pathnameAtDial === pathnameNow;
}
