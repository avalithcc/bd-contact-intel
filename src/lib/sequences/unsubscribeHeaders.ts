/**
 * List-Unsubscribe / List-Unsubscribe-Post (RFC 2369 + RFC 8058) for every Sequence message. These give Gmail its
 * native unsubscribe button; a recipient who uses it does not file a spam complaint. Pure: returns full header lines
 * for the send path's `extraHeaders` (PR 8), which still runs each through its own header-safety check.
 *
 * The https URI comes first so one-click works; the mailto alternative keeps opt-out working in clients without it and
 * feeds the reply path.
 */
const UNSAFE = /[\s<>,"]/; // whitespace (incl. CR/LF) and the characters that would break out of an angle-bracket URI
const MAILBOX = /^[^\s@<>,"]+@[^\s@<>,"]+$/;

export function buildUnsubscribeHeaders(unsubscribeUrl: string, senderAddress: string): string[] {
  if (!unsubscribeUrl.startsWith("https://") || UNSAFE.test(unsubscribeUrl)) {
    throw new Error("Unsubscribe URL must be an https URL with no whitespace or URI delimiters");
  }
  if (!MAILBOX.test(senderAddress)) throw new Error("Sender address is not a plain mailbox");
  return [
    `List-Unsubscribe: <${unsubscribeUrl}>, <mailto:${senderAddress}?subject=unsubscribe>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
  ];
}
