/**
 * A connection made before the email-sync feature shipped only granted
 * `gmail.send` — it cannot call `users.history.list`/`users.messages.list`,
 * so `/api/gmail/sync` (src/app/api/gmail/sync/route.ts) must skip it rather
 * than fail loudly on every 15-minute run. `grantedScopes` is the OAuth
 * token response's own `scope` field, recorded at callback time
 * (src/app/api/gmail/oauth/callback/route.ts) — it reflects what Google
 * actually granted, not what the app asked for, since a user can uncheck
 * scopes in the consent screen.
 */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function needsReconnectForSync(grantedScopes: string | null | undefined): boolean {
  if (!grantedScopes) return true;
  const scopes = grantedScopes.split(/\s+/).filter(Boolean);
  return !scopes.includes(GMAIL_READONLY_SCOPE);
}
