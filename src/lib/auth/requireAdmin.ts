/**
 * Admin-only guard for server actions/pages under /admin (design D5, R5).
 * The owner is seeded as the first admin (see drizzle/0013_unified_person.sql).
 * Reuses src/lib/queries.ts#getCurrentBd rather than re-resolving the
 * session, and delegates the actual check to the pure assertAdminRole
 * (src/lib/auth/adminRole.ts) so that predicate stays unit-testable without
 * a DB.
 */
import { getCurrentBd } from "@/lib/queries";
import { assertAdminRole } from "@/lib/auth/adminRole";

export { AdminRequiredError, assertAdminRole } from "@/lib/auth/adminRole";

/**
 * Resolves the current bd (see getCurrentBd) and asserts it is an admin.
 * Callers under /admin routes should let AdminRequiredError propagate to a
 * 404 (see design.md "Routes": admin pages 404 for non-admins), not a 403 —
 * the existence of admin-only screens is not meant to be discoverable.
 */
export async function requireAdmin() {
  const bd = await getCurrentBd();
  assertAdminRole(bd);
  return bd;
}
