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

// Strips a leading/trailing ```json ... ``` or ``` ... ``` fence, if present.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
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

  return { subject: trimmedSubject, body: trimmedBody };
}
