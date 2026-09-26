"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { updateContactProperty } from "@/lib/contacts/propertyEditDb";
import { isEditablePersonProperty } from "@/lib/contacts/propertyEdit";
import { assertContactEditableById } from "@/lib/contacts/queries";
import { createActivityAction } from "@/app/activity/actions";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import { sendGmailMessage } from "@/lib/gmail/send";
import { planMeeting } from "@/lib/contacts/meeting";
import { planDiscard } from "@/lib/contacts/discard";
import {
  contactActionErrorReason,
  PropertyNotEditableError,
  type ContactActionResult,
} from "./actionErrors";

// Unclassified errors reach the client only as "unexpected"; log them here so
// a real failure (DB, schema drift) still leaves a server-side trace.
function actionFailure(err: unknown): { ok: false; reason: ReturnType<typeof contactActionErrorReason> } {
  const reason = contactActionErrorReason(err);
  if (reason === "unexpected") console.error("[contacts] unexpected action error", err);
  return { ok: false, reason };
}

/**
 * Server action behind the About pane's per-property inline edit (task 9.2,
 * 9.4). Rejects any property outside the allow-list up front — see
 * src/lib/contacts/propertyEdit.ts's doc comment for why `ownerBdId` and
 * `status` are excluded. Returns a typed result instead of throwing
 * (fresh-review WARNING fix): a thrown Error's message is redacted by
 * Next.js in production, and a raw English message must never reach the
 * Spanish-only UI anyway — see actionErrors.ts.
 */
export async function updateContactPropertyAction(
  personId: string,
  property: string,
  value: string,
): Promise<ContactActionResult> {
  try {
    if (!isEditablePersonProperty(property)) throw new PropertyNotEditableError(property);
    const me = await getCurrentBd();
    await updateContactProperty(personId, property, value, me.id);
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/** "Nota" quick action (task 9.2) — writes a `note` activity for this Contact. */
export async function addContactNoteAction(personId: string, note: string): Promise<ContactActionResult> {
  try {
    await assertContactEditableById(personId);
    await createActivityAction({ type: "note", personId, metadata: { note } });
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/** "Tarea" quick action (task 9.2). */
export async function addContactTaskAction(
  personId: string,
  title: string,
  dueAt?: Date,
): Promise<ContactActionResult> {
  try {
    await assertContactEditableById(personId);
    await createTaskAction({ title, personId, dueAt });
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/** "Reunión" quick action (task 10.2) — writes a `meeting_logged` activity; status recomputes to `meeting` in the same transaction (recompute.ts, via createActivity). */
export async function logContactMeetingAction(
  personId: string,
  date: string,
  time: string,
  notes: string,
): Promise<ContactActionResult> {
  try {
    await assertContactEditableById(personId);
    const metadata = planMeeting(date, time, notes);
    await createActivityAction({ type: "meeting_logged", personId, metadata: { ...metadata } });
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/** "Descartar" quick action (task 10.3) — writes a `discarded` activity; planDiscard() rejects a missing reason or a missing note when reason is `other` (task 10.4). */
export async function discardContactAction(
  personId: string,
  reason: string | null,
  note: string,
): Promise<ContactActionResult> {
  try {
    await assertContactEditableById(personId);
    const metadata = planDiscard(reason, note);
    await createActivityAction({ type: "discarded", personId, metadata: { ...metadata } });
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export type SendContactEmailResult = ContactActionResult;

/** "Correo" quick action (task 9.2) — same Gmail send path as leads; no AI draft here. */
export async function sendContactEmailAction(
  personId: string,
  to: string,
  subject: string,
  body: string,
): Promise<SendContactEmailResult> {
  try {
    await assertContactEditableById(personId);
    const me = await getCurrentBd();
    await sendGmailMessage({ bdId: me.id, to, subject, body, personId });
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}
