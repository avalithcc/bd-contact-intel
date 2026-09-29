/**
 * Thin DB glue for scripts/reset-bd-password.ts's dry run. Imports `db`
 * (side-effecting, requires DATABASE_URL) so — same convention as
 * src/lib/contacts/manualSignalDb.ts — this file is not unit-tested
 * directly; src/lib/auth/bdAuthMatch.ts carries the tested matching logic.
 *
 * Read-only. `auth.users` has no Drizzle schema entry (it's Supabase's own
 * managed schema, not one this app owns), so it's read via a raw `sql`
 * template — the same connection already has access to it. Timestamps come
 * back as strings from raw `sql` and are normalized to `Date` here (see
 * PERFORMANCE.md / src/lib/whatsnew/queries.ts for the same pattern).
 *
 * Also reads `banned_until`/`deleted_at` (confirmed present on production's
 * `auth.users` via a read-only `SELECT banned_until, deleted_at FROM
 * auth.users LIMIT 0`) so bdAuthMatch.ts can refuse a banned or deleted
 * account instead of silently resetting a password nobody can use.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { bd } from "@/db/schema";
import { matchBdToAuthUser, type BdAuthMatch } from "@/lib/auth/bdAuthMatch";

type RawAuthUserRow = {
  id: string;
  email: string;
  last_sign_in_at: Date | string | null;
  created_at: Date | string;
  banned_until: Date | string | null;
  deleted_at: Date | string | null;
};

/**
 * Resolves the `bd` row and the `auth.users` row for a given email
 * (case-insensitive on both sides), or throws BdAuthMatchError with a
 * specific reason — see bdAuthMatch.ts for why an exact-casing mismatch
 * between the two is refused rather than guessed at.
 */
export async function resolveBdAuthUser(email: string): Promise<BdAuthMatch> {
  const trimmed = email.trim();

  const bdRows = await db
    .select({ id: bd.id, name: bd.name, email: bd.email, role: bd.role })
    .from(bd)
    .where(sql`lower(${bd.email}) = lower(${trimmed})`);

  const authRowsRaw = await db.execute<RawAuthUserRow>(
    sql`select id::text as id, email, last_sign_in_at, created_at, banned_until, deleted_at
        from auth.users
        where lower(email) = lower(${trimmed})
        limit 10`,
  );
  const authRows = [...authRowsRaw].map((r) => ({
    id: r.id,
    email: r.email,
    lastSignInAt: r.last_sign_in_at ? new Date(r.last_sign_in_at) : null,
    createdAt: new Date(r.created_at),
    bannedUntil: r.banned_until ? new Date(r.banned_until) : null,
    deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
  }));

  return matchBdToAuthUser(bdRows, authRows);
}
