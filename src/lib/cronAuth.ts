import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a bearer token against a shared secret.
 * Shared by every cron-triggered route (see src/app/api/hiring/sync/route.ts
 * and src/app/api/hiring/discover/route.ts) so there is exactly one
 * implementation of this check to get right. Hashing both sides first
 * avoids leaking the secret's length via timing (raw strings can differ in
 * length, which `timingSafeEqual` rejects up front).
 */
export function isValidBearer(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !authHeader) return false;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const actual = createHash("sha256").update(authHeader).digest();
  return timingSafeEqual(expected, actual);
}
