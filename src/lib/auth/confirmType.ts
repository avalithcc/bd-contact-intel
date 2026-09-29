import { type EmailOtpType } from "@supabase/supabase-js";

/**
 * Allowlist for the `type` query param on /auth/confirm (Supabase email-link
 * landing point). We only ever generate "recovery" (password reset) and
 * "invite" links ourselves. `EmailOtpType` also includes "signup",
 * "magiclink", "email_change", etc. — accepting any of those here would let
 * a crafted link call `verifyOtp` with a type this app never intended to
 * handle (e.g. an email-change confirmation, which
 * src/lib/auth/recoverySession.ts would then misread as a password-recovery
 * session and skip the current-password check in PasswordForm.tsx).
 */
const ALLOWED_CONFIRM_TYPES: ReadonlySet<EmailOtpType> = new Set([
  "recovery",
  "invite",
]);

/** Pure predicate. Fails closed: anything not proven allowed returns false. */
export function isAllowedConfirmType(
  type: string | null | undefined,
): type is EmailOtpType {
  if (typeof type !== "string") return false;
  return ALLOWED_CONFIRM_TYPES.has(type as EmailOtpType);
}
