/**
 * Unsubscribe request handlers as plain functions over injected ports. No route serves them until PR 13.
 *
 * GET renders, POST suppresses, never the other way round. Corporate mail scanners and inbox prefetchers open every
 * URL in an inbound message; a GET that acted would unsubscribe people who never touched the link. The GET handler is
 * therefore typed against a read-only port, so it cannot write even by mistake.
 */
import { hashUnsubscribeToken, isWellFormedUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

export type UnsubscribeView =
  | { kind: "confirm"; email: string; token: string }
  | { kind: "done"; email: string }
  /** Generic on purpose: names no address and does not say whether the token was unknown or malformed. */
  | { kind: "invalid" };

export interface UnsubscribeReadPort {
  /** One indexed read on token_hash. */
  findToken(tokenHash: string): Promise<{ email: string } | null>;
}

export interface UnsubscribePort extends UnsubscribeReadPort {
  /** The single write path: suppression + used_at + membership discards, in one transaction. Null if no such token. */
  suppressByToken(tokenHash: string): Promise<{ email: string } | null>;
}

const INVALID: UnsubscribeView = { kind: "invalid" };

export async function handleUnsubscribeGet(
  token: string | null | undefined,
  port: UnsubscribeReadPort,
): Promise<UnsubscribeView> {
  if (!isWellFormedUnsubscribeToken(token)) return INVALID;
  const found = await port.findToken(hashUnsubscribeToken(token));
  return found ? { kind: "confirm", email: found.email, token } : INVALID;
}

export interface UnsubscribePostInput {
  /** `?t=` on the request URL. RFC 8058 one-click posts here, with the token only in the URL. */
  queryToken: string | null | undefined;
  /** `t` field of the confirmation page's form. */
  formToken: string | null | undefined;
  /** Body was `List-Unsubscribe=One-Click`. Informational: both shapes share one write path and neither is gated. */
  oneClick: boolean;
}

/** No form token, referer or origin check: Gmail's native button sends none of them. The token is the credential. */
export async function handleUnsubscribePost(
  input: UnsubscribePostInput,
  port: UnsubscribePort,
): Promise<UnsubscribeView> {
  const token = isWellFormedUnsubscribeToken(input.queryToken) ? input.queryToken : input.formToken;
  if (!isWellFormedUnsubscribeToken(token)) return INVALID;
  const done = await port.suppressByToken(hashUnsubscribeToken(token));
  return done ? { kind: "done", email: done.email } : INVALID;
}
