/**
 * Pure resolver: turns candidate `bd` rows and candidate `auth.users` rows
 * (both fetched by src/lib/auth/bdAuthResolveDb.ts, case-insensitively by
 * email) into exactly one matched pair, or a specific typed failure.
 *
 * The `email_mismatch` check matters beyond hygiene: src/lib/queries.ts
 * `getCurrentBd()` resolves the signed-in user's `bd` row with an EXACT,
 * case-sensitive `eq(bd.email, user.email)` (see src/lib/queries.ts:41-61).
 * If `bd.email` and the matched `auth.users.email` differ only in casing,
 * the bd row this script found is not necessarily the one the app actually
 * uses at login — resetting that auth user's password could silently reset
 * the wrong (or a phantom, not-yet-created) bd's credentials. So a mismatch
 * refuses rather than guesses.
 */

export type BdAuthMatchFailureReason =
  | "bd_not_found"
  | "bd_multiple_matches"
  | "auth_user_not_found"
  | "auth_user_multiple_matches"
  | "email_mismatch";

export class BdAuthMatchError extends Error {
  constructor(
    public readonly reason: BdAuthMatchFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "BdAuthMatchError";
  }
}

export interface BdRowForMatch {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthUserRowForMatch {
  id: string;
  email: string;
  lastSignInAt: Date | null;
  createdAt: Date;
}

export interface BdAuthMatch {
  bd: BdRowForMatch;
  authUser: AuthUserRowForMatch;
}

export function matchBdToAuthUser(
  bdRows: readonly BdRowForMatch[],
  authRows: readonly AuthUserRowForMatch[],
): BdAuthMatch {
  if (bdRows.length === 0) {
    throw new BdAuthMatchError("bd_not_found", "No bd row found for that email.");
  }
  if (bdRows.length > 1) {
    throw new BdAuthMatchError(
      "bd_multiple_matches",
      `Found ${bdRows.length} bd rows matching that email (expected exactly 1): ${bdRows
        .map((r) => `${r.id} <${r.email}>`)
        .join(", ")}`,
    );
  }
  if (authRows.length === 0) {
    throw new BdAuthMatchError("auth_user_not_found", "No auth.users row found for that email.");
  }
  if (authRows.length > 1) {
    throw new BdAuthMatchError(
      "auth_user_multiple_matches",
      `Found ${authRows.length} auth.users rows matching that email (expected exactly 1): ${authRows
        .map((r) => `${r.id} <${r.email}>`)
        .join(", ")}`,
    );
  }

  const [bdRow] = bdRows;
  const [authRow] = authRows;

  if (bdRow!.email !== authRow!.email) {
    throw new BdAuthMatchError(
      "email_mismatch",
      `bd.email ("${bdRow!.email}") and auth.users.email ("${authRow!.email}") do not match exactly. ` +
        "getCurrentBd() matches by exact, case-sensitive email — fix the mismatch before resetting.",
    );
  }

  return { bd: bdRow!, authUser: authRow! };
}
