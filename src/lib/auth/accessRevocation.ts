/**
 * Pure constants for revoking a BD's CRM access (scripts/revoke-bd-access.ts).
 *
 * Why this is its own module rather than a constant inside the script: the
 * ban is expressed to GoTrue as a DURATION string ("876000h"), not as an
 * instant, and a duration that is too short fails in the worst possible way
 * — the admin API returns success, the operator reads "access revoked", and
 * the account quietly comes back to life months later with nobody watching.
 * A typo that drops a zero is invisible at the call site and silent in
 * production. So the duration is defined once, derived from a named number
 * of years, and pinned by tests/unit/accessRevocation.test.ts.
 *
 * Postgres `timestamptz` tops out at year 294276, so a century is safely
 * representable; GoTrue stores the computed instant in `banned_until`.
 */

/** A revocation is meant to be permanent. GoTrue has no "forever", so: a century. */
export const PERMANENT_BAN_YEARS = 100;

const HOURS_PER_YEAR = 24 * 365;

/** GoTrue's `ban_duration` wants a Go duration string; hours is the largest unit it accepts. */
export const PERMANENT_BAN_HOURS = PERMANENT_BAN_YEARS * HOURS_PER_YEAR;

/** The exact value handed to `admin.updateUserById({ ban_duration })`. */
export const PERMANENT_BAN_DURATION = `${PERMANENT_BAN_HOURS}h`;

/**
 * The instant GoTrue is expected to write into `auth.users.banned_until` for
 * a ban starting at `now`. The script reads the real column back after the
 * call and compares against this, so a duration the server interpreted
 * differently than we meant is caught instead of reported as success.
 */
export function expectedBanReleaseAt(now: Date): Date {
  return new Date(now.getTime() + PERMANENT_BAN_HOURS * 60 * 60 * 1000);
}

/**
 * Whether a `banned_until` read back from `auth.users` actually locks the
 * account out for good. Deliberately generous (10 years): GoTrue may round
 * or clamp, and the question this answers is "is this person locked out for
 * the rest of their working life", not "did the arithmetic match exactly".
 */
export function isEffectivelyPermanent(bannedUntil: Date | null, now: Date): boolean {
  if (bannedUntil === null) return false;
  const tenYearsMs = 10 * HOURS_PER_YEAR * 60 * 60 * 1000;
  return bannedUntil.getTime() - now.getTime() >= tenYearsMs;
}
