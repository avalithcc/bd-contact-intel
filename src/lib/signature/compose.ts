import type { MessageContent } from "@/lib/gmail/rawMessage";
import { sanitizeSignatureHtml } from "@/lib/signature/sanitize";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Builds what `sendGmailMessage` sends for a composed message.
 *
 * - BD without a signature (NULL, blank, or one that sanitizes to nothing):
 *   returns the legacy `{ body }` shape untouched, so the message stays
 *   single-part text/plain exactly as before this feature.
 * - BD with a signature: `{ bodyHtml }`. The typed text is escaped (a pasted
 *   `<script>` is text, not markup) with line breaks as `<br>`, then ONE
 *   blank line (`<br>`) and the signature in its own `<div>`.
 *
 * Boundary choice: a blank line and a wrapper div, no `<hr>` and no "-- "
 * delimiter. The signature is the BD's own complete block (logo, links,
 * styling); adding a rule or dashes would duplicate or fight what they built.
 * The wrapper div keeps their table layout from merging into the body text.
 *
 * The stored signature is sanitized again here (idempotent) so a row written
 * by anything other than the save action can never reach a client unfiltered.
 */
export function composeEmailBody(text: string, signatureHtml: string | null | undefined): MessageContent {
  const signature = signatureHtml ? sanitizeSignatureHtml(signatureHtml) : "";
  if (signature === "") return { body: text };
  const bodyHtml = escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");
  return { bodyHtml: `<div>${bodyHtml}</div><br><div>${signature}</div>` };
}

/**
 * Whether a signature block will actually be appended to a body — the SAME emptiness test `composeEmailBody` above and
 * `composeReleaseBody` apply, so a caller cannot reach a different verdict than the send path does.
 *
 * It lives here, next to the two functions that append, because the generator needs it to decide whether the body may
 * carry its own sign-off: a body that signs off AND gets a signature appended is double-signed, which is what every
 * Sequence email did until 2026-10-28. Keeping it beside them means a change to what counts as "no signature" cannot
 * update one side only.
 */
export function signatureWillFollow(signatureHtml: string | null | undefined): boolean {
  return sanitizeSignatureHtml(signatureHtml ?? "") !== "";
}
