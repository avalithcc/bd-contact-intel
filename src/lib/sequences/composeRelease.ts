/**
 * The body of a released Sequence email: the BD's message, then the BD's signature, then the compliance footer last.
 * Pure. Separate from composeEmailBody (scheduled and one-off email, which have no footer) so those callers cannot change.
 *
 * - No usable signature (NULL, blank, or one that sanitizes to nothing): the stored plain body is returned untouched,
 *   byte for byte, so a BD without a signature sends exactly what was sent before this existed.
 * - Signature: HTML. Message and footer are escaped like composeEmailBody escapes, EXCEPT the per-recipient unsubscribe
 *   URL, which stays a real `<a href>` (it is the legal opt-out; escaping it into dead text would defeat it).
 * - Footer not recognised (the BD edited it beyond a few dashes or blank lines; splitFooter): the signature goes at the very
 *   end and the text is not rewritten. A footer is never synthesised here. In that case the signature can follow the link,
 *   and the text keeps the message's own size, because nothing here can tell which part of it is the footer.
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

/**
 * The compliance block is set smaller and greyer than the message, so it stops competing with what the BD wrote
 * (owner request, 2026-10-22). INLINE styles only: mail clients strip `<style>` blocks, so a stylesheet would leave the
 * footer unstyled in most inboxes.
 *
 * MIN_FOOTER_PX is a floor, not a preference. CAN-SPAM requires the opt-out to be "clear and conspicuous", so this text
 * may be quieter than the message but never hidden. Do not take it below the floor to win vertical space; a footer
 * nobody can read is the same legal exposure as no footer.
 */
const MIN_FOOTER_PX = 12;
const FOOTER_STYLE = `font-size:${MIN_FOOTER_PX}px;line-height:1.5;color:#6b7280`;
/**
 * The unsubscribe anchor keeps a link colour of its own, in EVERY position. Without it the anchor inherits the footer's
 * grey and stops reading as something you can click — which is precisely the conspicuousness the footer exists to provide.
 */
const LINK_STYLE = "color:#2563eb;text-decoration:underline";

function lines(text: string, link: string | null): string {
  const escape = (s: string) => escapeHtml(s).replace(/\r\n|\r|\n/g, "<br>");
  if (!link) return escape(text);
  const anchor = `<a href="${escapeHtml(link)}" style="${LINK_STYLE}">${escapeHtml(link)}</a>`;
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
    content: { bodyHtml: `<div>${lines(parts.message.trimEnd(), link)}</div><br><div>${signature}</div><br><div style="${FOOTER_STYLE}">${lines(parts.footer, link)}</div>` },
  };
}
