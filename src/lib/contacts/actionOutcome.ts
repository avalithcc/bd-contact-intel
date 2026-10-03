import type { ContactActionResult, ContactActionErrorReason } from "@/app/(app)/contacts/actionErrors";

/**
 * Server actions on the record page already return a typed `{ ok: false }`
 * for every failure they can name. What they cannot do is answer at all when
 * the request itself dies (dropped connection, HTTP 500): the client's
 * `await` then THROWS, and a handler written for `{ ok }` skips everything
 * after it (including `setBusy(false)`), freezing the form.
 *
 * `settleAction` closes that seam: it never rejects. A throw becomes the
 * `unconfirmed` reason, which is deliberately NOT "not saved" — when the
 * transport fails mid-request the write may or may not have landed, and the
 * copy has to say so rather than invite a blind retry (a duplicate).
 */
export async function settleAction(run: () => Promise<ContactActionResult>): Promise<ContactActionResult> {
  try {
    return await run();
  } catch {
    return { ok: false, reason: "unconfirmed" };
  }
}

export type NoteFollowUpOutcome =
  | { kind: "saved" }
  // The note was NOT written (or not confirmed); nothing else was attempted.
  | { kind: "note_failed"; reason: ContactActionErrorReason }
  // The note IS written; the follow-up task is not (or not confirmed).
  | { kind: "follow_up_failed"; reason: ContactActionErrorReason };

/**
 * The note composer's "Guardar nota" + optional "Agregar tarea de
 * seguimiento". Two independent writes from the browser, so partial success
 * is a real state and is reported as such: it is never folded into "saved".
 * `noteAlreadySaved` is the retry path after `follow_up_failed` — it skips
 * the note so a retry cannot duplicate it. A blank title writes no task.
 */
export async function saveNoteWithFollowUp(input: {
  noteAlreadySaved: boolean;
  followUpTitle: string;
  saveNote: () => Promise<ContactActionResult>;
  saveFollowUp: (title: string) => Promise<ContactActionResult>;
}): Promise<NoteFollowUpOutcome> {
  if (!input.noteAlreadySaved) {
    const note = await settleAction(input.saveNote);
    if (!note.ok) return { kind: "note_failed", reason: note.reason };
  }
  const title = input.followUpTitle.trim();
  if (title) {
    const task = await settleAction(() => input.saveFollowUp(title));
    if (!task.ok) return { kind: "follow_up_failed", reason: task.reason };
  }
  return { kind: "saved" };
}
