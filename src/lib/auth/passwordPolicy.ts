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
