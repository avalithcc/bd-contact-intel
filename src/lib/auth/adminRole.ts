/**
 * Pure admin-role predicate (design D5, R5), kept free of any DB import so
 * it can be unit-tested without DATABASE_URL — see
 * tests/unit/requireAdmin.test.ts. The DB-backed wrapper lives in
 * src/lib/auth/requireAdmin.ts.
 */
export class AdminRequiredError extends Error {
  constructor() {
    super("Admin role required");
    this.name = "AdminRequiredError";
  }
}

/**
 * Throws AdminRequiredError unless `bd.role === "admin"`. Accepts a plain
 * `{ role }` shape (rather than the full `Bd` type) so callers — and this
 * file's tests — don't need a real bd row to exercise the check.
 */
export function assertAdminRole(bd: { role: string } | null | undefined): void {
  if (bd?.role !== "admin") throw new AdminRequiredError();
}
