/**
 * The body of a released Sequence email: the BD's message, then the BD's signature, then the compliance footer last.
 * Pure. Separate from composeEmailBody (scheduled and one-off email, which have no footer) so those callers cannot change.
 *
 * - No usable signature (NULL, blank, or one that sanitizes to nothing): the stored plain body is returned untouched,
 *   byte for byte, so a BD without a signature sends exactly what was sent before this existed.
 * - Signature: HTML. Message and footer are escaped like composeEmailBody escapes, EXCEPT the per-recipient unsubscribe
 *   URL, which stays a real `<a href>` (it is the legal opt-out; escaping it into dead text would defeat it).
 * - Footer not found (the BD edited it away): the signature goes at the very end and the text is not rewritten. A footer
 *   is never synthesised here.
 *
 * `link` is read from the RAW stored body by the caller's own extraction, so it is the same token the List-Unsubscribe
 * header names.
 */
import type { MessageContent } from "@/lib/gmail/rawMessage";
import { escapeHtml } from "@/lib/signature/compose";
import { sanitizeSignatureHtml } from "@/lib/signature/sanitize";
import { splitFooter } from "./complianceFooter";
import type { ComplianceConfig } from "./config";

function lines(text: string, link: string | null): string {
  const escape = (s: string) => escapeHtml(s).replace(/\r\n|\r|\n/g, "<br>");
  if (!link) return escape(text);
  const anchor = `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`;
  return text.split(link).map(escape).join(anchor);
}

export function composeReleaseBody(body: string, signatureHtml: string | null | undefined, link: string | null, config: ComplianceConfig): MessageContent {
  const signature = signatureHtml ? sanitizeSignatureHtml(signatureHtml) : "";
  if (signature === "") return { body };
  const parts = splitFooter(body, config);
  if (!parts) return { bodyHtml: `<div>${lines(body, link)}</div><br><div>${signature}</div>` };
  return { bodyHtml: `<div>${lines(parts.message.trimEnd(), link)}</div><br><div>${signature}</div><br><div>${lines(parts.footer, link)}</div>` };
}
