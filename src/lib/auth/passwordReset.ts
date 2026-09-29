/**
 * Self-service password reset ("¿Olvidaste tu contraseña?") is built but
 * switched OFF, deliberately, until the Supabase project has its own SMTP.
 *
 * Why it cannot work today, verified 2026-09-29:
 * - Supabase's built-in email service only delivers to members of the
 *   project's own team, heavily rate-limited — BDs would never get the mail.
 * - Without custom SMTP the "Reset Password" template cannot be edited, and
 *   the default one sends `{{ .ConfirmationURL }}`, which returns with a PKCE
 *   `?code=`; `/auth/confirm` only understands `token_hash`.
 * - The form shows the same confirmation whether or not the email exists
 *   (no account enumeration), so the failure would be silent: "check your
 *   inbox", and nothing ever arrives.
 *
 * To turn it on: configure custom SMTP, set the Reset Password template to
 * `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`,
 * make `/auth/confirm` also accept `code` (exchangeCodeForSession), then
 * flip this flag and test the full round trip in production.
 */
export const PASSWORD_RESET_ENABLED = false;
