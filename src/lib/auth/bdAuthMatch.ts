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
  | "auth_user_deleted"
  | "auth_user_banned"
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
  /** GoTrue's temporary/permanent ban marker — set to a far-future date for a permanent ban. */
  bannedUntil: Date | null;
  /** GoTrue's soft-delete marker. Non-null means the account is deleted. */
  deletedAt: Date | null;
}

export interface BdAuthMatch {
  bd: BdRowForMatch;
  authUser: AuthUserRowForMatch;
}

export interface MatchBdToAuthUserOptions {
  /** Reference time for the banned_until check. Defaults to `new Date()`. */
  now?: Date;
}

export function matchBdToAuthUser(
  bdRows: readonly BdRowForMatch[],
  authRows: readonly AuthUserRowForMatch[],
  options: MatchBdToAuthUserOptions = {},
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

  // Refuse before anything else touches this account's own disabled state —
  // "refusing is always safer than resetting an account the operator may
  // not know is disabled." Checked before email_mismatch deliberately: a
  // deleted or banned account is disqualified on its own terms, regardless
  // of whether its email also happens to agree with the bd row.
  if (authRow!.deletedAt !== null) {
    throw new BdAuthMatchError(
      "auth_user_deleted",
      `auth.users row ${authRow!.id} has deleted_at set (${authRow!.deletedAt!.toISOString()}) — refusing to reset a deleted account.`,
    );
  }
  const now = options.now ?? new Date();
  if (authRow!.bannedUntil !== null && authRow!.bannedUntil.getTime() > now.getTime()) {
    throw new BdAuthMatchError(
      "auth_user_banned",
      `auth.users row ${authRow!.id} is banned until ${authRow!.bannedUntil.toISOString()} — refusing to reset a banned account.`,
    );
  }

  if (bdRow!.email !== authRow!.email) {
    throw new BdAuthMatchError(
      "email_mismatch",
      `bd.email ("${bdRow!.email}") and auth.users.email ("${authRow!.email}") do not match exactly. ` +
        "getCurrentBd() matches by exact, case-sensitive email — fix the mismatch before resetting.",
    );
  }

  return { bd: bdRow!, authUser: authRow! };
}
