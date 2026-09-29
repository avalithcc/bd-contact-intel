/**
 * Pure password-change validator shared by PasswordForm.tsx (and any future
 * server-side path) — one place for the "new password" rules from the
 * approved mockup (openspec/changes/crm-hubspot-ux/mockups/account-password.html:
 * "Al menos 12 caracteres.") instead of re-typing the minimum length ad hoc.
 *
 * Checks run in a fixed priority order so only one error is ever surfaced at
 * a time, matching the single inline error state the mockup shows per field:
 * 1. current password missing (only when requireCurrent is true)
 * 2. new password too short
 * 3. new password identical to the current one (only when requireCurrent is
 *    true — with no current password to compare against, this is left to
 *    Supabase's own `same_password` server error, mapped by the caller)
 * 4. confirmation does not match
 */

export const MIN_NEW_PASSWORD_LENGTH = 12;

export type PasswordChangeErrorField = "current" | "new" | "confirm";
export type PasswordChangeErrorCode =
  | "required"
  | "tooShort"
  | "sameAsCurrent"
  | "mismatch";

export interface PasswordChangeError {
  field: PasswordChangeErrorField;
  code: PasswordChangeErrorCode;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  /** False only for a detected recovery session — see recoverySession.ts. */
  requireCurrent: boolean;
}

/**
 * Maps `supabase.auth.updateUser()`'s error.code to a field-level outcome,
 * for the server-side enforcement path (see PasswordForm.tsx and
 * src/lib/auth/passwordReset.ts): once the owner enables the Supabase
 * project's "Require current password to update password" setting
 * (server-side GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD —
 * see node_modules/@supabase/auth-js/dist/module/lib/types.d.ts,
 * UserAttributes.current_password's doc comment), a wrong `current_password`
 * is rejected by GoTrue itself, not just by this app's client-side
 * signInWithPassword pre-check.
 *
 * `"invalid_credentials"` and `"same_password"` are both real, defined codes
 * in node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts.
 * Supabase does not document which exact code a wrong `current_password` on
 * `updateUser` returns — `"invalid_credentials"` is the SDK's standard
 * "these credentials don't match" code (the same one `signInWithPassword`
 * itself returns for a wrong password), so it is used here as the
 * best-supported inference, not a documented guarantee. If the owner
 * confirms a different code once the setting is verified enabled, this
 * mapping should be revisited. Every other error code — known or not —
 * falls through to the generic top-level error, never a misleading
 * per-field message.
 */
export function mapUpdateUserError(
  errorCode: string | null | undefined,
  requireCurrent: boolean,
):
  | { field: "new"; code: "sameAsCurrent" }
  | { field: "current"; code: "incorrect" }
  | { field: null; code: "generic" } {
  if (errorCode === "same_password") {
    return { field: "new", code: "sameAsCurrent" };
  }
  if (requireCurrent && errorCode === "invalid_credentials") {
    return { field: "current", code: "incorrect" };
  }
  return { field: null, code: "generic" };
}

export function validatePasswordChange(
  input: PasswordChangeInput,
): PasswordChangeError | null {
  const { currentPassword, newPassword, confirmPassword, requireCurrent } =
    input;

  if (requireCurrent && !currentPassword) {
    return { field: "current", code: "required" };
  }

  if (newPassword.length < MIN_NEW_PASSWORD_LENGTH) {
    return { field: "new", code: "tooShort" };
  }

  if (requireCurrent && newPassword === currentPassword) {
    return { field: "new", code: "sameAsCurrent" };
  }

  if (newPassword !== confirmPassword) {
    return { field: "confirm", code: "mismatch" };
  }

  return null;
}
