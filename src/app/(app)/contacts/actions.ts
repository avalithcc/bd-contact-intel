"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { updateContactProperty, updateContactProperties } from "@/lib/contacts/propertyEditDb";
import { isEditablePersonProperty, type LocationEditFields } from "@/lib/contacts/propertyEdit";
import { assertContactEditableById } from "@/lib/contacts/queries";
import { changeContactCompany } from "@/lib/contacts/companyChangeDb";
import { searchContactCompanies } from "@/lib/contacts/companySearchDb";
import type { TaskSubjectSearchResult } from "@/lib/tasks/subjectSearch";
import { createActivityAction } from "@/app/activity/actions";
import { completeTaskAction, createTaskAction } from "@/app/(app)/tasks/actions";
import { sendGmailMessage } from "@/lib/gmail/send";
import { planMeeting } from "@/lib/contacts/meeting";
import { planCall } from "@/lib/contacts/call";
import { planDiscard } from "@/lib/contacts/discard";
import { addManualSignal } from "@/lib/contacts/manualSignalDb";
import { bulkAssignOwner } from "@/lib/contacts/bulkOwnerDb";
import { normalizeOwnerSelectValue } from "@/lib/contacts/bulkOwner";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { getConversationForAdmin, type AdminConversationData } from "@/lib/activity/getConversationForAdmin";
import { getPersonTimeline, type TimelineEntry } from "@/lib/activity/queries";
import { isTimelinePillKey } from "@/lib/activity/timelinePills";
import { isUuid } from "@/lib/uuid";
import {
  contactActionErrorReason,
  contactLocationActionErrorReason,
  OwnerReassignLockedError,
  OwnerValueInvalidError,
  PropertyNotEditableError,
  type ContactActionResult,
  type ContactLocationActionResult,
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
    // mode: "single" — this is one Contact's own record page, not a
    // list-page bulk/filter-wide reassignment; the audit_log row must say
    // so (see bulkOwnerAudit.ts's "owner_change" vs "bulk_owner_change").
    const plan = await bulkAssignOwner([personId], ownerBdId, me.id, { mode: "single" });
    if (plan[0]?.outcome === "skipped_has_connection") throw new OwnerReassignLockedError();
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
  durationMinutes: string,
  notes: string,
): Promise<ContactActionResult> {
  try {
    await assertContactEditableById(personId);
    const metadata = planCall(outcome, direction, date, time, durationMinutes, notes);
    await createActivityAction({ type: "call", personId, metadata: { ...metadata } });
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
 * `getConversationForAdminAction` above) and `pillKey` via
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
    const { entries } = await getPersonTimeline(personId, me.id, { pill });
    return { ok: true, entries };
  } catch (err) {
    console.error("[contacts] getTimelinePillEntriesAction failed", err);
    return { ok: false };
  }
}
