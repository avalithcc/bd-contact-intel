/**
 * The UI-facing combined-draft format for the email channel: one string,
 * "Asunto: <subject>\n\n<body>", used by GenerateOutreachMessageResult.message
 * (src/lib/outreach/generateMessage.ts) so the record page's editable
 * "Borrador" textarea (GenerateMessageDialog.tsx) can show/edit subject and
 * body as one field, matching the mockup (a single "Borrador" textarea, no
 * separate subject input in the "Generar mensaje" dialog).
 *
 * `splitEmailDraft` is the inverse, used by the "Usar en correo" action to
 * prefill the actual email composer's separate Para/Asunto/Mensaje fields —
 * it runs over whatever text is currently in the textarea, which may be the
 * model's original draft OR one the BD has since hand-edited, so it must
 * degrade gracefully rather than throw on unexpected text.
 */

export function formatEmailDraft(subject: string, body: string): string {
  return `Asunto: ${subject}\n\n${body}`;
}

export interface SplitEmailDraft {
  subject: string;
  body: string;
}

const DRAFT_PATTERN = /^Asunto:\s*(.*)\n\n([\s\S]*)$/;

export function splitEmailDraft(text: string): SplitEmailDraft {
  const match = text.match(DRAFT_PATTERN);
  if (!match) return { subject: "", body: text.trim() };
  return { subject: match[1]!.trim(), body: match[2]!.trim() };
}
