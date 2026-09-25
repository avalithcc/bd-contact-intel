"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { updateContactProperty } from "@/lib/contacts/propertyEditDb";
import { isEditablePersonProperty } from "@/lib/contacts/propertyEdit";
import { assertContactEditableById } from "@/lib/contacts/queries";
import { createActivityAction } from "@/app/activity/actions";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import { sendGmailMessage } from "@/lib/gmail/send";

/**
 * Server action behind the About pane's per-property inline edit (task 9.2,
 * 9.4). Rejects any property outside the allow-list up front — see
 * src/lib/contacts/propertyEdit.ts's doc comment for why `ownerBdId` and
 * `status` are excluded.
 */
export async function updateContactPropertyAction(
  personId: string,
  property: string,
  value: string,
) {
  if (!isEditablePersonProperty(property)) {
    throw new Error(`Property is not editable from the record page: ${property}`);
  }

  const me = await getCurrentBd();
  const updated = await updateContactProperty(personId, property, value, me.id);
  revalidatePath(`/contacts/${personId}`);
  return updated;
}

/** "Nota" quick action (task 9.2) — writes a `note` activity for this Contact. */
export async function addContactNoteAction(personId: string, note: string) {
  await assertContactEditableById(personId);
  return createActivityAction({ type: "note", personId, metadata: { note } });
}

/** "Tarea" quick action (task 9.2). */
export async function addContactTaskAction(personId: string, title: string, dueAt?: Date) {
  await assertContactEditableById(personId);
  return createTaskAction({ title, personId, dueAt });
}

export type SendContactEmailResult = { ok: true } | { ok: false; error: string };

/** "Correo" quick action (task 9.2) — same Gmail send path as leads; no AI draft here. */
export async function sendContactEmailAction(
  personId: string,
  to: string,
  subject: string,
  body: string,
): Promise<SendContactEmailResult> {
  await assertContactEditableById(personId);
  const me = await getCurrentBd();
  try {
    await sendGmailMessage({ bdId: me.id, to, subject, body, personId });
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gmail send failed" };
  }
}
