/**
 * Self-service password reset ("¿Olvidaste tu contraseña?") — ON since
 * 2026-09-29, after it was verified end to end in production.
 *
 * It was switched off until the Supabase project had its own SMTP: the
 * built-in email service only delivers to members of the project's team, and
 * the form deliberately shows the same confirmation whether or not the email
 * exists (no account enumeration), so without SMTP it failed silently.
 *
 * What it depends on — all on the Supabase project, not in this repo:
 * - Custom SMTP: Resend (`smtp.resend.com:465`, user `resend`, a
 *   sending-only API key as password), sender `notificaciones@crm.avalith.net`,
 *   name "Avalith CRM". The subdomain crm.avalith.net is verified in Resend
 *   (DKIM `resend._domainkey.crm`, SPF/MX on `send.crm`); the apex avalith.net
 *   is registered in a different Resend account, so it cannot be used.
 *   HostGator's `notificaciones@avalith.net` was dropped on 2026-10-16: its
 *   outbound filter silently discarded the designed reset template.
 * - Templates: generated from the app's email layout by
 *   scripts/build-supabase-email-templates.ts into supabase/email-templates/.
 * - The "Reset Password" template links to
 *   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
 *   Because it sends `token_hash`, `/auth/confirm` never receives a PKCE
 *   `code`; if the template is ever reverted to `{{ .ConfirmationURL }}`,
 *   resets break with "invalid link".
 * - Site URL `https://crm.avalith.net` (since 2026-10-16) and the exact
 *   redirect allow-list entries `https://crm.avalith.net/auth/confirm` and
 *   `https://bd-contact-intel.vercel.app/auth/confirm` (no wildcards).
 *
 * Verified on 2026-09-29: a reset email reached the owner's inbox (not spam),
 * the link opened `/account/password` as a recovery session, and the new
 * password was saved WITH `security_update_password_require_current_password`
 * enabled — GoTrue exempts recovery sessions from that check, which is what
 * PasswordForm.tsx assumes when it omits `current_password` on this path.
 *
 * To switch it off again (e.g. SMTP credentials revoked), set this to false:
 * the login link disappears and `/forgot-password` returns 404.
 */
export const PASSWORD_RESET_ENABLED = true;
