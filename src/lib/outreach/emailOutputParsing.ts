/**
 * Parses the model's raw text output for the email channel (see the
 * "email" branch of buildOutreachMessagePrompt in messagePrompt.ts, which
 * asks for a bare JSON object) into a typed {subject, body}. Pure string
 * parsing — no AI call, no DB.
 *
 * The prompt asks for exactly `{"subject": "...", "body": "..."}`, but a
 * model can still wrap it in a markdown code fence or add stray
 * whitespace; this is the "output-format parsing risk" flagged in the
 * change description. Returns `null` on anything that doesn't parse into
 * the expected shape, so the caller can fall back to a
 * "generationFailed"/"invalidModelOutput" error instead of showing broken
 * output.
 */

export interface ParsedEmailMessage {
  subject: string;
  body: string;
}

// Hard caps applied AFTER parsing/trimming — a degenerate or
// injection-influenced model response (e.g. history/notes content trying
// to steer the output, see messagePrompt.ts's untrusted-data handling)
// could otherwise push an unbounded subject/body into the "Borrador"
// dialog and the email composer it feeds. Capping (not rejecting) keeps a
// too-long draft usable rather than a hard failure — same policy as the
// LinkedIn DM cap below (generateMessage.ts applies MAX_BODY_CHARS there
// too, "the same cap" per the fix request).
export const MAX_SUBJECT_CHARS = 150;
export const MAX_BODY_CHARS = 2000;

// Strips a leading/trailing ```json ... ``` or ``` ... ``` fence, if present.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

// A subject is a single-line UI field (dialog "Borrador" first line, email
// composer's Asunto input) — any newline in it (model formatting slip, or
// an attempt to inject extra "lines" via history/notes content) is
// collapsed to a single space BEFORE the length cap, so the cap always
// operates on the final single-line text (not e.g. hidden behind a
// newline that later gets collapsed into something longer).
export function capSubject(subject: string): string {
  const collapsed = subject.replace(/\s*\n\s*/g, " ").trim();
  return collapsed.length > MAX_SUBJECT_CHARS ? collapsed.slice(0, MAX_SUBJECT_CHARS) : collapsed;
}

// The body/DM text is multi-line by design (paragraphs) — only truncated,
// newlines are left as-is.
export function capBody(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function parseEmailModelOutput(rawText: string): ParsedEmailMessage | null {
  const candidate = stripCodeFence(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const { subject, body } = parsed as Record<string, unknown>;
  if (typeof subject !== "string" || typeof body !== "string") {
    return null;
  }

  const trimmedSubject = subject.trim();
  const trimmedBody = body.trim();
  if (!trimmedSubject || !trimmedBody) {
    return null;
  }

  return {
    subject: capSubject(trimmedSubject),
    body: capBody(trimmedBody, MAX_BODY_CHARS),
  };
}
