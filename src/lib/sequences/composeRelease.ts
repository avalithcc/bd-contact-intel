/**
 * The body of a released Sequence email: the BD's message, then the BD's signature, then the compliance footer last.
 * Pure. Separate from composeEmailBody (scheduled and one-off email, which have no footer) so those callers cannot change.
 *
 * - No usable signature (NULL, blank, or one that sanitizes to nothing): the stored plain body is returned untouched,
 *   byte for byte, so a BD without a signature sends exactly what was sent before this existed.
 * - Signature: HTML. Message and footer are escaped like composeEmailBody escapes, EXCEPT the per-recipient unsubscribe
 *   URL, which stays a real `<a href>` (it is the legal opt-out; escaping it into dead text would defeat it).
 * - Footer not recognised (the BD edited it beyond a few dashes or blank lines; splitFooter): the signature goes at the very
 *   end and the text is not rewritten. A footer is never synthesised here. In that case the signature can follow the link.
 *
 * ONE link, ONE variable. The unsubscribe link is extracted here, from the footer splitFooter identified (the whole body
 * when there is none), and returned alongside the content. The caller builds the List-Unsubscribe header from that same
 * `link` and the anchor below is built from it too, so the header and the visible link cannot name different tokens. This
 * also fixes a pre-existing header bug: extraction used to take the FIRST match in the body, so a body holding two links
 * (an older footer pasted mid-message) named the wrong token in the header even before signatures existed.
 */
import type { MessageContent } from "@/lib/gmail/rawMessage";
import { escapeHtml } from "@/lib/signature/compose";
import { sanitizeSignatureHtml } from "@/lib/signature/sanitize";
import { splitFooter } from "./complianceFooter";
import { extractUnsubscribeUrl } from "./complianceGate";
import type { ComplianceConfig } from "./config";

function lines(text: string, link: string | null): string {
  const escape = (s: string) => escapeHtml(s).replace(/\r\n|\r|\n/g, "<br>");
  if (!link) return escape(text);
  const anchor = `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`;
  return text.split(link).map(escape).join(anchor);
}

export function composeReleaseBody(
  body: string,
  signatureHtml: string | null | undefined,
  config: ComplianceConfig,
): { link: string | null; content: MessageContent } {
  const parts = splitFooter(body, config);
  const link = (parts && extractUnsubscribeUrl(parts.footer)) || extractUnsubscribeUrl(body);
  const signature = signatureHtml ? sanitizeSignatureHtml(signatureHtml) : "";
  if (signature === "") return { link, content: { body } };
  if (!parts) return { link, content: { bodyHtml: `<div>${lines(body, link)}</div><br><div>${signature}</div>` } };
  return {
    link,
    content: { bodyHtml: `<div>${lines(parts.message.trimEnd(), link)}</div><br><div>${signature}</div><br><div>${lines(parts.footer, link)}</div>` },
  };
}
