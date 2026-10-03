/**
 * Input guard for a NEW email sent from the Contact record. The subject is
 * typed by the user and must not be blank. A reply is deliberately exempt: its
 * subject is derived server-side from the thread (replySubject), never typed.
 */
export type NewEmailInputResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; reason: "email_subject_required" | "email_body_required" };

export function validateNewEmailInput(subject: string, body: string): NewEmailInputResult {
  const trimmedSubject = subject.trim();
  if (!trimmedSubject) return { ok: false, reason: "email_subject_required" };
  const trimmedBody = body.trim();
  if (!trimmedBody) return { ok: false, reason: "email_body_required" };
  return { ok: true, subject: trimmedSubject, body: trimmedBody };
}
