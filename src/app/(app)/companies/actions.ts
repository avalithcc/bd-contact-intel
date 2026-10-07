"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createCompany, getCompanyByKey, updateCompany } from "@/lib/companies/queries";
import { getCurrentBd } from "@/lib/queries";
import { proposeAbsorption, type ProposeAbsorptionResult } from "@/lib/companies/absorptionDb";
import type { Company, NewCompany } from "@/db/schema";
import { createActivityAction } from "@/app/activity/actions";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import { setTaskStatusChecked } from "@/lib/tasks/updateWithActivity";
import { meetingErrorReason, planMeeting, type MeetingErrorReason } from "@/lib/contacts/meeting";
import { updateCompanyProperty } from "@/lib/companies/propertyEditDb";
import {
  isEditableCompanyProperty,
  type EditableCompanyProperty,
} from "@/lib/companies/propertyEdit";
import { propertyEditFailureOf, type PropertyEditFailure } from "@/lib/companies/propertyEditFailure";
import { getCompanyTimeline } from "@/lib/companies/recordQueries";
import { isCompanyActivityFilter } from "@/lib/companies/recordMappers";
import { buildCompanyTimelineViewRows, type CompanyTimelineViewRow } from "@/lib/companies/timelineView";
import { stageLabelOf } from "@/lib/companies/listMappers";
import { getDictionary } from "@/lib/i18n/server";

export async function createCompanyAction(input: {
  companyKey: string;
  displayName: string;
  relationshipStage?: string;
  revenuePotential?: number;
  notes?: string;
}) {
  const me = await getCurrentBd();

  const company = await createCompany({
    ...input,
    createdByBdId: me.id,
    updatedByBdId: me.id,
  } as NewCompany);

  revalidatePath("/companies");

  return company;
}

export async function updateCompanyAction(
  companyKey: string,
  updates: {
    displayName?: string;
    relationshipStage?: string;
    revenuePotential?: number;
    notes?: string;
  },
) {
  const me = await getCurrentBd();

  const company = await updateCompany(companyKey, {
    ...updates,
    updatedByBdId: me.id,
  });

  revalidatePath("/companies");
  revalidatePath(`/companies/${companyKey}`);

  return company;
}

/**
 * Single-property inline edit on the Company record page (company-fields
 * change, owner-approved 2026-09-26): Industria, Responsable, Ciudad, País.
 * Mirrors the Contact record page's per-property edit action. `property`
 * is validated against the allow-list here (not trusted from the client),
 * and `updateCompanyProperty` re-validates `ownerBdId` against real `bd`
 * rows before writing.
 *
 * A typed, user-correctable failure (bad LinkedIn URL, client status, owner,
 * company not found) is returned as `{ ok: false, failure }` rather than
 * thrown: Next.js replaces a thrown server-action message with a generic one
 * in production, which would hide the reason from the BD. Anything else is
 * rethrown so a real bug still fails loudly.
 */
export async function updateCompanyPropertyAction(
  companyKey: string,
  property: string,
  rawNewValue: string,
): Promise<{ ok: true; company: Company } | { ok: false; failure: PropertyEditFailure }> {
  if (!isEditableCompanyProperty(property)) {
    throw new Error(`Property not editable: ${property}`);
  }
  const me = await getCurrentBd();

  let company: Company;
  try {
    company = await updateCompanyProperty(companyKey, property as EditableCompanyProperty, rawNewValue, me.id);
  } catch (err) {
    const failure = propertyEditFailureOf(err);
    if (failure) return { ok: false, failure };
    throw err;
  }

  revalidatePath("/companies");
  revalidatePath(`/companies/${companyKey}`);

  return { ok: true, company };
}

/**
 * Stage change now also logs a `status_change` activity (mockup-port c03;
 * company-record.html:81 shows "Etapa cambiada de Prospecto → Calificada"
 * in the timeline) — the plain `updateCompanyAction` write alone never
 * produced a timeline entry, so the Activity tab's "Cambios de etapa"
 * filter previously had nothing real to show. Only logs when the stage
 * actually changes (never a no-op activity row).
 */
export async function updateCompanyStageAction(
  companyKey: string,
  newStage: "prospect" | "qualified" | "proposal_sent" | "won" | "lost",
) {
  const before = await getCompanyByKey(companyKey);
  const result = await updateCompanyAction(companyKey, {
    relationshipStage: newStage,
  });
  if (before && before.relationshipStage !== newStage) {
    await createActivityAction({
      type: "status_change",
      companyKey,
      metadata: { from: before.relationshipStage, status: newStage },
    });
  }
  return result;
}

export interface CompanyActionResult {
  ok: boolean;
  message?: string;
  /** Typed reason the client maps to dictionary copy (set only where an expected, user-fixable error exists; today the meeting action). */
  reason?: MeetingErrorReason;
}

// A redirect()/notFound() thrown inside the try (e.g. getCurrentBd()'s
// defense-in-depth auth redirect, reached transitively via
// createActivityAction/createTaskAction) must reach Next's router, not be
// swallowed into a generic `{ ok: false }` result — see
// tests/unit/rethrowNavigationErrors.test.ts.
function actionFailure(err: unknown): CompanyActionResult {
  unstable_rethrow(err);
  return { ok: false, message: err instanceof Error ? err.message : String(err) };
}

/**
 * Company-scoped quick actions (mockup-port c03; company-record.html:66).
 * `createActivityAction`/`createTaskAction` (src/app/activity/actions.ts,
 * src/app/(app)/tasks/actions.ts) already accept a `companyKey` subject —
 * these are thin wrappers over that existing, subject-agnostic machinery
 * (same pattern as the Contact record's Nota/Tarea quick actions), not a
 * schema or core-logic change.
 */
export async function addCompanyNoteAction(companyKey: string, note: string): Promise<CompanyActionResult> {
  try {
    await createActivityAction({ type: "note", companyKey, metadata: { note } });
    revalidatePath(`/companies/${companyKey}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/** `description`/`assignedToBdId` join in task-essentials (backlog items
 * 1-2) — both optional, same defaulting as every other creation path
 * (`createTaskAction` resolves a blank/omitted assignee to the caller). */
export async function addCompanyTaskAction(
  companyKey: string,
  title: string,
  dueAt?: Date,
  description?: string,
  assignedToBdId?: string,
): Promise<CompanyActionResult> {
  try {
    await createTaskAction({ title, companyKey, dueAt, description, assignedToBdId });
    revalidatePath(`/companies/${companyKey}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * "Reunión" quick action (company-record.html:66). `planMeeting` (src/lib/
 * contacts/meeting.ts) is already subject-agnostic — it only plans the
 * `{at, notes}` metadata from raw date/time/notes input, the same planner
 * `logContactMeetingAction` uses for a person. The "extension to accept
 * companyKey" is this wrapper: `createActivityAction` already has a
 * `companyKey` parameter, so no change was needed to either the planner or
 * the generic activity writer — only this new company-scoped entry point.
 */
export async function logCompanyMeetingAction(
  companyKey: string,
  date: string,
  time: string,
  notes: string,
): Promise<CompanyActionResult> {
  try {
    const metadata = planMeeting(date, time, notes);
    await createActivityAction({ type: "meeting_logged", companyKey, metadata: { ...metadata } });
    revalidatePath(`/companies/${companyKey}`);
    return { ok: true };
  } catch (err) {
    // Expected, user-fixable meeting errors go out as a typed reason (never
    // a raw English message in a Spanish UI); anything else, including
    // redirect/notFound, takes the normal path.
    const reason = meetingErrorReason(err);
    if (reason) return { ok: false, reason };
    return actionFailure(err);
  }
}

/**
 * Known-IDOR fix (task-edit change): this used to call the generic,
 * UNSCOPED `completeTaskAction(taskId)` (a plain `WHERE id = taskId`
 * update) — any signed-in BD could complete ANY task by guessing/copying
 * its id, regardless of which company (or contact) it actually belonged
 * to. Now routes through the same shared `setTaskStatusChecked`
 * (src/lib/tasks/updateWithActivity.ts) every other completion/reopen entry
 * point uses: it reads the task's OWN real subject and scopes the write to
 * it — correct even for a task `getCompanyOpenTasks` (recordQueries.ts)
 * shows here because it belongs to one of the company's PEOPLE, not the
 * company itself (`company_key` would be null on that row).
 */
export async function completeCompanyTaskAction(taskId: string, companyKey: string): Promise<CompanyActionResult> {
  try {
    const me = await getCurrentBd();
    await setTaskStatusChecked(taskId, "done", me);
    revalidatePath(`/companies/${companyKey}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export type CompanyTimelineFilterFetchResult = { ok: true; rows: CompanyTimelineViewRow[] } | { ok: false };

/**
 * Scoped fetch for one Activity-tab filter (fix/company-timeline-filter-no-
 * reload) — the company-timeline counterpart of `getTimelinePillEntriesAction`
 * (contacts/actions.ts). `CompanyTimeline.tsx` calls this only when the
 * already-loaded pool can't be trusted for `filter` (see
 * `resolveCompanyScopeRows`, recordMappers.ts), never on every click.
 *
 * `filter` is re-validated here via `isCompanyActivityFilter` rather than
 * trusted from the client, same rule `getTimelinePillEntriesAction` follows
 * for `pillKey`. Returns already-formatted `CompanyTimelineViewRow`s (see
 * `buildCompanyTimelineViewRows`'s doc comment) — never the raw rows plus a
 * formatter, since this result crosses back into the "use client"
 * `CompanyTimeline.tsx`.
 */
export async function getCompanyTimelineFilterEntriesAction(
  companyKey: string,
  filter: string | undefined,
): Promise<CompanyTimelineFilterFetchResult> {
  try {
    const me = await getCurrentBd();
    const validFilter = isCompanyActivityFilter(filter) ? filter : undefined;
    const [rows, dict] = await Promise.all([
      getCompanyTimeline(companyKey, { filter: validFilter }),
      getDictionary(),
    ]);
    const l = dict.companyRecord;
    const lc = dict.companyList;
    const viewRows = buildCompanyTimelineViewRows(
      rows,
      dict.companyRecordServer,
      l,
      (stage) => stageLabelOf(stage, lc),
      me.id,
    );
    return { ok: true, rows: viewRows };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[companies] getCompanyTimelineFilterEntriesAction failed", err);
    return { ok: false };
  }
}

/**
 * "This company was absorbed by that one": records a PROPOSAL for the owner, never a merge (the merge stays an
 * owner-run script). Any BD may call it, so there is no admin gate; the proposer is always the session's bd, never
 * a client-supplied id. Refusals come back as data (`reason`, plus `openProposalId` when one is already open).
 * Not wired to any component yet: the record-page affordance waits on an approved mockup.
 */
export async function proposeCompanyAbsorptionAction(absorbedKey: string, survivorKey: string, note?: string): Promise<ProposeAbsorptionResult> {
  const me = await getCurrentBd();
  const result = await proposeAbsorption({ absorbedKey, survivorKey, proposerBdId: me.id, note });
  if (result.ok) revalidatePath(`/companies/${absorbedKey}`);
  return result;
}
