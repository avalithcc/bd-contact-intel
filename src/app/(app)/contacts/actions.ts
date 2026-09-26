"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { updateContactProperty } from "@/lib/contacts/propertyEditDb";
import { isEditablePersonProperty } from "@/lib/contacts/propertyEdit";
import { assertContactEditableById } from "@/lib/contacts/queries";
import { createActivityAction } from "@/app/activity/actions";
import { completeTaskAction, createTaskAction } from "@/app/(app)/tasks/actions";
import { sendGmailMessage } from "@/lib/gmail/send";
import { planMeeting } from "@/lib/contacts/meeting";
import { planDiscard } from "@/lib/contacts/discard";
import { addManualSignal } from "@/lib/contacts/manualSignalDb";
import { bulkAssignOwner } from "@/lib/contacts/bulkOwnerDb";
import { normalizeOwnerSelectValue } from "@/lib/contacts/bulkOwner";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { getConversationForAdmin, type AdminConversationData } from "@/lib/activity/getConversationForAdmin";
import { isUuid } from "@/lib/uuid";
import {
  contactActionErrorReason,
  OwnerReassignLockedError,
  OwnerValueInvalidError,
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

/**
 * Single-record owner reassignment (task 13.3 parity gap: `/leads/[id]`
 * offered this, `/contacts/[id]`'s generic property editor deliberately
 * excludes `ownerBdId` — see propertyEdit.ts's doc comment). Reuses
 * `bulkAssignOwner` — the SAME R3 rule as the list's bulk "Asignar
 * responsable" (task 13.2) and `updateLeadOwner`, applied to a one-element
 * selection, so a single-record and bulk reassignment can never disagree on
 * when a reassignment is allowed.
 */
export async function updateContactOwnerAction(
  personId: string,
  ownerBdIdRaw: string,
): Promise<ContactActionResult> {
  try {
    await assertContactEditableById(personId);
    const ownerBdId = normalizeOwnerSelectValue(ownerBdIdRaw);
    if (ownerBdId === undefined) throw new OwnerValueInvalidError();
    const me = await getCurrentBd();
    const plan = await bulkAssignOwner([personId], ownerBdId, me.id);
    if (plan[0]?.outcome === "skipped_has_connection") throw new OwnerReassignLockedError();
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

/**
 * "Marcar como hecha" on a record-page timeline/right-panel task row
 * (mockup-port r03/r05; contact-record.html:111/181). Thin wrapper over the
 * existing `completeTaskAction` (src/app/(app)/tasks/actions.ts) — same
 * write, same semantics — that additionally revalidates this Contact's own
 * page, since `completeTaskAction` itself only revalidates /tasks, /leads,
 * /companies (it has no personId to revalidate with).
 */
export async function completeContactTaskAction(taskId: string, personId: string): Promise<ContactActionResult> {
  try {
    await completeTaskAction(taskId);
    revalidatePath(`/contacts/${personId}`);
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

/**
 * "Pegar señal" quick action (task 11.6) — writes a `manual_paste` signal
 * row for this Contact. Ports the legacy `/leads/[id]` and `/contact/[id]`
 * "+ Paste signal" composer (`src/app/ManualSignal.tsx`) onto the record
 * page; those legacy pages are now redirect-only (task 11.4/PR 11c).
 */
export async function addContactSignalAction(personId: string, text: string): Promise<ContactActionResult> {
  try {
    await assertContactEditableById(personId);
    const me = await getCurrentBd();
    await addManualSignal(personId, text, me.id);
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export type RevealAdminConversationResult =
  | { ok: true; data: AdminConversationData }
  | { ok: false; reason: "not_admin" | "invalid" | "not_found" };

/**
 * Inline "Ver conversación" reveal (mockup-port r04; contact-record-
 * admin.html:130/137 — the mockup shows this expanded directly in the
 * timeline, not only on the separate `/contacts/[id]/conversation/[bdId]`
 * page). Goes through the EXACT SAME audited path that page already uses
 * (`getConversationForAdmin` — writes `audit_log(view_conversation)` before
 * returning content, and skips the audit write only when the viewer is
 * looking at their own conversation, `shouldAuditConversationView`). The
 * separate page stays as a deep link (bookmarkable, no client JS needed to
 * reach it); this action is what powers the inline expand.
 */
export async function revealAdminConversationAction(
  personId: string,
  targetBdId: string,
): Promise<RevealAdminConversationResult> {
  if (!isUuid(personId) || !isUuid(targetBdId)) return { ok: false, reason: "invalid" };
  let me;
  try {
    me = await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) return { ok: false, reason: "not_admin" };
    throw err;
  }
  const result = await getConversationForAdmin(personId, targetBdId, me.id);
  if (result.kind === "not_found") return { ok: false, reason: "not_found" };
  const { kind: _kind, ...data } = result;
  return { ok: true, data };
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
