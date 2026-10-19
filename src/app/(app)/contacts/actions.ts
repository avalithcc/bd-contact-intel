"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { updateContactProperty, updateContactProperties } from "@/lib/contacts/propertyEditDb";
import { isEditablePersonProperty, type LocationEditFields } from "@/lib/contacts/propertyEdit";
import { assertContactEditableById } from "@/lib/contacts/queries";
import { changeContactCompany } from "@/lib/contacts/companyChangeDb";
import { searchContactCompanies } from "@/lib/contacts/companySearchDb";
import { validateNewEmailInput } from "@/lib/contacts/newEmailInput";
import type { TaskSubjectSearchResult } from "@/lib/tasks/subjectSearch";
import { createActivityAction } from "@/app/activity/actions";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import { setTaskStatusChecked } from "@/lib/tasks/updateWithActivity";
import { sendGmailMessage } from "@/lib/gmail/send";
import { composeEmailBody } from "@/lib/signature/compose";
import { logUnsafeReplyHeader, planThreadReply } from "@/lib/gmail/replyThread";
import { getThreadReplySource } from "@/lib/gmail/threadMessages";
import { planMeeting } from "@/lib/contacts/meeting";
import { planCall } from "@/lib/contacts/call";
import { recordCallAttempt, resolveCallAttempt, settleCallAttempt } from "@/lib/contacts/callAttemptDb";
import type { DialledField } from "@/lib/contacts/callAttempt";
import { planDiscard } from "@/lib/contacts/discard";
import { addManualSignal } from "@/lib/contacts/manualSignalDb";
import { bulkAssignOwner } from "@/lib/contacts/bulkOwnerDb";
import { normalizeOwnerSelectValue } from "@/lib/contacts/bulkOwner";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { isAdminRole } from "@/lib/auth/adminRole";
import { softDeleteContactNote } from "@/lib/activity/noteDeleteDb";
import { getPersonTimeline, type TimelineEntry } from "@/lib/activity/queries";
import { isTimelinePillKey } from "@/lib/activity/timelinePills";
import { isUuid } from "@/lib/uuid";
import { isPlainCompose, type ComposeExtras } from "@/lib/email/compose/prepare";
import { hasSuppressedOthers, prepareComposeForCurrentUser, prepareReplyAttachmentsForCurrentUser, removeSentAttachments } from "@/lib/email/compose/server";
import {
  actionFailure,
  contactLocationActionErrorReason,
  OwnerValueInvalidError,
  PropertyNotEditableError,
  type ContactActionResult,
  type ContactLocationActionResult,
} from "./actionErrors";

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
 * Atomic save for the "Ubicación" composite row (fresh-review CRITICAL fix
 * — see `LocationPropertyRow` in PropertyList.tsx and `planLocationEdit`'s
 * doc comment). Replaces three sequential
 * `updateContactPropertyAction(personId, "city"|"region"|"country", ...)`
 * calls with ONE call that plans and writes all three fields in a single
 * transaction: a rejected field leaves `city`/`region`/`country` exactly as
 * they were, and only fields whose trimmed value actually changed get a
 * `person_property_history` row (same per-field diffing as the
 * single-property action — see `planLocationEdit`).
 */
export async function updateContactLocationAction(
  personId: string,
  fields: LocationEditFields,
): Promise<ContactLocationActionResult> {
  try {
    const me = await getCurrentBd();
    await updateContactProperties(personId, fields, me.id);
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    const located = contactLocationActionErrorReason(err);
    if (located) return { ok: false, ...located };
    // A non-batch failure (e.g. the contact was merged/not found) happened
    // before any field was even planned — it isn't attributable to one
    // field, so the UI shows it as a plain row-level error instead of
    // pointing at city/region/country.
    const { reason } = actionFailure(err);
    return { ok: false, reason, property: null };
  }
}

/**
 * Single-record owner reassignment (task 13.3 parity gap: `/leads/[id]`
 * offered this, `/contacts/[id]`'s generic property editor deliberately
 * excludes `ownerBdId` — see propertyEdit.ts's doc comment). Reuses
 * `bulkAssignOwner` — the same write as the list's bulk "Asignar
 * responsable" (task 13.2), applied to a one-element selection. Always
 * applies (no connection gate), is admin-only, and is sticky against the
 * automatic owner rule.
 */
export async function updateContactOwnerAction(
  personId: string,
  ownerBdIdRaw: string,
): Promise<ContactActionResult> {
  try {
    // Admin-only; AdminRequiredError surfaces as the "admin_required" reason.
    const me = await requireAdmin();
    await assertContactEditableById(personId);
    const ownerBdId = normalizeOwnerSelectValue(ownerBdIdRaw);
    if (ownerBdId === undefined) throw new OwnerValueInvalidError();
    // mode: "single" — this is one Contact's own record page, not a
    // list-page bulk/filter-wide reassignment; the audit_log row must say
    // so (see bulkOwnerAudit.ts's "owner_change" vs "bulk_owner_change").
    await bulkAssignOwner([personId], ownerBdId, me.id, { mode: "single" });
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Company-only search for the "Cambiar empresa" dialog (contact-record.html
 * :160's pencil icon — previously inert, see page.tsx's comment history).
 * Same bounded-query/debounce shape as searchTaskSubjectsAction, but a
 * dedicated company-only query (companySearchDb.ts) rather than the task
 * dialog's person+company search, which would scan persons pointlessly.
 */
export async function searchContactCompaniesAction(query: string): Promise<TaskSubjectSearchResult[]> {
  await getCurrentBd();
  return searchContactCompanies(query);
}

/**
 * Changes (or clears) a contact's company by picking one already on file —
 * never by typing free text (see companyChange.ts's doc comment for why:
 * `company`/`companyKey` must move together, and a free-text path would let
 * the base fill with "Globant", "globant SA" and "Globant." as three
 * companies). `companyKey: null` detaches the contact from its current
 * company.
 */
export async function changeContactCompanyAction(
  personId: string,
  companyKey: string | null,
): Promise<ContactActionResult> {
  try {
    const me = await getCurrentBd();
    await changeContactCompany(personId, companyKey, me.id);
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

/**
 * "Eliminar nota" on a timeline note card (contact-note-delete). Soft delete only. The author-or-admin rule is enforced inside
 * softDeleteContactNote against the row as stored and the BD resolved here, never against anything the client sends, so a
 * forged call for someone else's note fails the same way whether or not the menu item was shown.
 */
export async function deleteContactNoteAction(noteId: string): Promise<ContactActionResult> {
  try {
    if (!isUuid(noteId)) return { ok: false, reason: "not_found" };
    const me = await getCurrentBd();
    const { personId } = await softDeleteContactNote(me, noteId);
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/** "Tarea" quick action (task 9.2). `description`/`assignedToBdId` join in
 * task-essentials (backlog items 1-2) — both optional, same defaulting
 * (`createTaskAction` resolves a blank/omitted assignee to the caller). */
export async function addContactTaskAction(
  personId: string,
  title: string,
  dueAt?: Date,
  description?: string,
  assignedToBdId?: string,
): Promise<ContactActionResult> {
  try {
    await assertContactEditableById(personId);
    await createTaskAction({ title, personId, dueAt, description, assignedToBdId });
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * "Marcar como hecha" on a record-page timeline/right-panel task row
 * (mockup-port r03/r05; contact-record.html:111/181).
 *
 * Authorization, id+subject-scoped write and `task_completed` activity
 * logging all live in ONE place now — `setTaskStatusChecked`
 * (src/lib/tasks/updateWithActivity.ts), shared by every completion/reopen
 * entry point in the app (task-edit change). It reads the task's OWN real
 * subject fresh (not this `personId` argument, kept only for
 * `revalidatePath` below), so a task that exists but belongs to someone
 * else still throws `TaskNotFoundError` (-> "not_found") — same guarantee
 * the original IDOR fix (review, timeline-tasks-pill) established.
 */
export async function completeContactTaskAction(taskId: string, personId: string): Promise<ContactActionResult> {
  try {
    const me = await getCurrentBd();
    await setTaskStatusChecked(taskId, "done", me);
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * "Reabrir" on the record page's "Tareas" filter pill (mockup-port
 * timeline-tasks-pill) — the reopen counterpart of
 * `completeContactTaskAction` above, same shared write path.
 */
export async function reopenContactTaskAction(taskId: string, personId: string): Promise<ContactActionResult> {
  try {
    const me = await getCurrentBd();
    await setTaskStatusChecked(taskId, "open", me);
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

/** "Registrar llamada" quick action (contact-record mockup, first among
 * calling/emailing actions, HubSpot order) — writes a `call` activity;
 * status recomputes from direction/outcome in the same transaction
 * (deriveStatus.ts, via createActivity). */
export async function logCallAction(
  personId: string,
  outcome: string,
  direction: string,
  date: string,
  time: string,
  notes: string,
): Promise<ContactActionResult> {
  try {
    await assertContactEditableById(personId);
    const metadata = planCall(outcome, direction, date, time, notes);
    await createActivityAction({ type: "call", personId, metadata: { ...metadata } });
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export type CallAttemptActionResult = { ok: true; attemptId: string; field: DialledField } | { ok: false };

/**
 * The `tel:` click (call-logging-one-tap, variant A): records a `call_attempt`
 * for the number just dialled. Never moves status or ownership; a double click
 * within the dedupe window returns the same attempt.
 */
export async function recordCallAttemptAction(personId: string, number: string): Promise<CallAttemptActionResult> {
  try {
    if (!isUuid(personId)) return { ok: false };
    const me = await getCurrentBd();
    const attempt = await recordCallAttempt(personId, me.id, number);
    revalidatePath(`/contacts/${personId}`);
    return { ok: true, attemptId: attempt.attemptId, field: attempt.field };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[contacts] call attempt not recorded", err);
    return { ok: false };
  }
}

/** The outcome bar's answer: "connected" writes a `call` row dated at the dial; the others only close the attempt. */
export async function resolveCallAttemptAction(
  attemptId: string,
  personId: string,
  outcome: string,
  notes: string,
): Promise<ContactActionResult> {
  try {
    if (!isUuid(attemptId) || !isUuid(personId)) return { ok: false, reason: "not_found" };
    const me = await getCurrentBd();
    await resolveCallAttempt(attemptId, personId, me.id, outcome, notes);
    revalidatePath(`/contacts/${personId}`);
    revalidatePath("/contacts");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * "Más detalles…" on the outcome bar: the full call form settles the SAME
 * attempt (one `call` row carrying the dialled number, the attempt folded into
 * it). Same errors and future-date guard as `logCallAction`.
 */
export async function settleCallAttemptAction(
  attemptId: string,
  personId: string,
  outcome: string,
  date: string,
  time: string,
  notes: string,
): Promise<ContactActionResult> {
  try {
    if (!isUuid(attemptId) || !isUuid(personId)) return { ok: false, reason: "not_found" };
    const me = await getCurrentBd();
    await settleCallAttempt(attemptId, personId, me.id, { outcome, date, time, notes });
    revalidatePath(`/contacts/${personId}`);
    revalidatePath("/contacts");
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

export type SendContactEmailResult = ContactActionResult;

/** "Correo" quick action (task 9.2) — same Gmail send path as leads; no AI draft here. */
export async function sendContactEmailAction(
  personId: string,
  to: string,
  subject: string,
  body: string,
  extras?: ComposeExtras,
): Promise<SendContactEmailResult> {
  try {
    // A NEW email needs its own subject and body; a reply is exempt (its
    // subject comes from the thread, see sendThreadReplyAction). Returned as
    // a typed reason, never thrown: Next redacts thrown messages in production.
    if (!isUuid(personId)) return { ok: false, reason: "not_found" };
    const input = validateNewEmailInput(subject, body);
    if (!input.ok) return { ok: false, reason: input.reason };
    await assertContactEditableById(personId);
    const me = await getCurrentBd();
    // BD with a signature sends HTML (body + signature); without one the
    // message is the same single-part plain text as before (composeEmailBody).
    const message = { bdId: me.id, subject: input.subject, ...composeEmailBody(input.body, me.signatureHtml), personId };
    if (isPlainCompose(extras)) {
      await sendGmailMessage({ ...message, to });
    } else {
      // Several "Para" contacts, "Cc" and/or files. The server is the authority on all three (same-company rule, internal
      // Cc, file policy and the real bytes read back from Storage): the client's `to` is not used.
      const prepared = await prepareComposeForCurrentUser(personId, extras!, true);
      if (!prepared.ok) return { ok: false, reason: prepared.reason };
      // An opted-out extra recipient stops the send: never emailed by adding them, never dropped silently.
      if (await hasSuppressedOthers(prepared)) return { ok: false, reason: "recipient_suppressed" };
      const several = prepared.recipients.length > 1;
      await sendGmailMessage({
        ...message,
        to: prepared.to,
        allowRecipientList: several,
        recipients: several ? prepared.recipients : undefined,
        cc: prepared.cc,
        attachments: prepared.files,
      });
      await removeSentAttachments(prepared.files.map((f) => f.storagePath));
    }
    revalidatePath(`/contacts/${personId}`);
    for (const other of extras?.recipientPersonIds ?? []) if (isUuid(other)) revalidatePath(`/contacts/${other}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * "Responder" on a synced thread. The client sends ONLY the thread id and the
 * typed text: recipient, subject and the threading headers are re-derived here
 * from the stored messages (planThreadReply), so a tampered request cannot
 * redirect the reply or inject a header, and what the BD saw in the dialog is
 * what goes out. The signature composes exactly as on a new message.
 */
export async function sendThreadReplyAction(
  personId: string,
  gmailThreadId: string,
  body: string,
  attachments?: unknown[],
): Promise<SendContactEmailResult> {
  try {
    if (!isUuid(personId) || !gmailThreadId || !body.trim()) return { ok: false, reason: "not_found" };
    await assertContactEditableById(personId);
    const me = await getCurrentBd();
    const plan = planThreadReply(await getThreadReplySource(me.id, personId, gmailThreadId));
    if (!plan.ok) {
      if (plan.reason === "unsafe_header") logUnsafeReplyHeader(me.id, personId, gmailThreadId);
      return { ok: false, reason: plan.reason === "unsafe_header" ? "reply_unsafe_header" : "reply_unavailable" };
    }
    // Recipients stay exactly what the thread dictates; a reply only gains files.
    const files = await prepareReplyAttachmentsForCurrentUser(attachments ?? []);
    if (!files.ok) return { ok: false, reason: files.reason };
    await sendGmailMessage({
      bdId: me.id,
      to: plan.to,
      subject: plan.subject,
      ...composeEmailBody(body.trim(), me.signatureHtml),
      personId,
      allowRecipientList: true,
      reply: { threadId: plan.threadId, inReplyTo: plan.inReplyTo, references: plan.references },
      attachments: files.files,
    });
    await removeSentAttachments(files.files.map((f) => f.storagePath));
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export type TimelinePillFetchResult = { ok: true; entries: TimelineEntry[] } | { ok: false };

/**
 * Read side of the record page's instant pill filter (fix/timeline-filter-
 * no-reload). Called from the client only when the entry pool Timeline.tsx
 * already holds is proven NOT to cover a pill's true count (see
 * isPillSelectionComplete, timelinePills.ts) — the same `getPersonTimeline`
 * query a `?activityType=` navigation used to trigger, minus the full-page
 * server render (no dictionary/session/company lookups, no other tab's
 * data — just this one query).
 *
 * `personId`/`pillKey` arrive from the client as plain strings (a Server
 * Action is a public endpoint, not a type-checked function call) —
 * `personId` is re-validated via `isUuid` (same convention as
 * the other record actions) and `pillKey` via
 * `isTimelinePillKey`, rather than either being trusted.
 */
export async function getTimelinePillEntriesAction(
  personId: string,
  pillKey: string | undefined,
): Promise<TimelinePillFetchResult> {
  try {
    if (!isUuid(personId)) return { ok: false };
    const me = await getCurrentBd();
    const pill = pillKey && isTimelinePillKey(pillKey) ? pillKey : undefined;
    const { entries } = await getPersonTimeline(personId, me.id, {
      pill,
      // Derived from the session's own bd row, never from anything the client sent.
      viewerIsAdmin: isAdminRole(me),
    });
    return { ok: true, entries };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[contacts] getTimelinePillEntriesAction failed", err);
    return { ok: false };
  }
}
