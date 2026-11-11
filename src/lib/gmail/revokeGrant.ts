/**
 * Pure classification of Google's OAuth revocation response
 * (https://oauth2.googleapis.com/revoke), used by
 * scripts/disconnect-bd-mailbox.ts.
 *
 * Why this is pure and tested rather than an inline `res.ok` check: both
 * ways of getting it wrong are silent and opposite.
 *
 *  - Reading 400 `invalid_token` as a FAILURE blocks the operator forever on
 *    a grant that is already dead — the script refuses to finish, and the
 *    stale encrypted token stays in `email_account` for good.
 *  - Reading a 500 or a network blip as SUCCESS is worse: the script clears
 *    our only copy of the refresh token, reports "mailbox disconnected", and
 *    leaves a LIVE grant on the person's mailbox that nobody can revoke any
 *    more, because the token needed to revoke it was just deleted.
 *
 * So the three outcomes are named, and the caller is forced to tell them
 * apart before it is allowed to destroy anything.
 */

export type RevokeOutcome =
  /** Google accepted the revocation. The grant is gone. */
  | "revoked"
  /** Google says the token is already invalid — expired or revoked earlier. Equivalent to success. */
  | "already_invalid"
  /** Anything else: a server error, a rate limit, a network failure. Nothing was proven; do NOT clear the token. */
  | "retry";

/**
 * `status` is the HTTP status, `body` the raw response text. Google answers a
 * revoked-or-unknown token with 400 and an `invalid_token` error payload; it
 * is not an error condition for us, it is the state we were trying to reach.
 */
export function classifyRevokeResponse(status: number, body: string): RevokeOutcome {
  if (status >= 200 && status < 300) return "revoked";
  if (status === 400 && /invalid_token/i.test(body)) return "already_invalid";
  return "retry";
}

/** Whether this outcome means the grant is certainly dead, and our stored copy is therefore safe to destroy. */
export function grantIsGone(outcome: RevokeOutcome): boolean {
  return outcome === "revoked" || outcome === "already_invalid";
}
