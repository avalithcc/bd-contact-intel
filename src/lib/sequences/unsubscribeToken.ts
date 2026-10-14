/**
 * Unsubscribe tokens: 256 random bits, base64url. Only the sha256 of a token is ever stored
 * (sequence_unsubscribe_token.token_hash), so a database read cannot be turned into working links. Pure.
 *
 * A token is issued per SEND, never reused: a raw token cannot be recovered from its hash, and several tokens per
 * member are expected. Every token stays valid for as long as its row exists (no clock in the verification path).
 */
import { createHash, randomBytes } from "node:crypto";

// 32 bytes -> 43 base64url characters, unpadded.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateUnsubscribeToken(): string {
  return randomBytes(32).toString("base64url");
}

/** True only for the exact shape generateUnsubscribeToken() produces. Check before any lookup. */
export function isWellFormedUnsubscribeToken(token: string | null | undefined): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export function hashUnsubscribeToken(token: string): string {
  if (!isWellFormedUnsubscribeToken(token)) throw new Error("Malformed unsubscribe token");
  return createHash("sha256").update(token).digest("hex");
}

/** The absolute link placed in the footer and in List-Unsubscribe. `siteUrl` comes from resolveSiteUrl(). */
export function buildUnsubscribeUrl(siteUrl: string, token: string): string {
  const base = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  return `${base}/api/unsubscribe?t=${token}`;
}
