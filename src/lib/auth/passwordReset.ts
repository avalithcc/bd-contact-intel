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
 * - Custom SMTP: HostGator mailbox `notificaciones@avalith.net` via
 *   `amanti.websitewelcome.com:465`, sender name "Avalith BD". SPF
 *   (`include:websitewelcome.com`, which covers the server's IP) and HostGator's
 *   DKIM key (`default._domainkey.avalith.net`) are published for avalith.net.
 *   Do NOT use `mail.avalith.net` — it resolves to a different server.
 * - The "Reset Password" template links to
 *   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
 *   Because it sends `token_hash`, `/auth/confirm` never receives a PKCE
 *   `code`; if the template is ever reverted to `{{ .ConfirmationURL }}`,
 *   resets break with "invalid link".
 * - Site URL `https://bd-contact-intel.vercel.app` and the exact redirect
 *   allow-list entry `https://bd-contact-intel.vercel.app/auth/confirm`
 *   (no wildcards).
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
