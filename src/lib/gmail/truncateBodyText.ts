/**
 * Caps a stored email body at MAX_BODY_TEXT_BYTES (fresh-review fix,
 * 2026-09-30: an unbounded body_text column lets one oversized message blow
 * up row/backup size). Measured in UTF-8 bytes, not JS string length/chars,
 * since that's what actually lands in Postgres. `email_message.bodyTruncated`
 * records whether this ran so a future UI can say "message truncated".
 */
export const MAX_BODY_TEXT_BYTES = 256 * 1024;

export interface TruncatedBody {
  text: string;
  truncated: boolean;
}

export function truncateBodyText(text: string, maxBytes: number = MAX_BODY_TEXT_BYTES): TruncatedBody {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return { text, truncated: false };

  // Buffer#toString("utf8") replaces bytes cut mid-multi-byte-codepoint with
  // U+FFFD rather than throwing — strip a trailing one so truncation never
  // leaves a visible replacement-character artifact.
  const cut = buf.subarray(0, maxBytes).toString("utf8").replace(/�+$/, "");
  return { text: cut, truncated: true };
}
