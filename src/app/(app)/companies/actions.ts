"use server";

import { revalidatePath } from "next/cache";
import { createCompany, getCompanyByKey, updateCompany } from "@/lib/companies/queries";
import { getCurrentBd } from "@/lib/queries";
import type { NewCompany } from "@/db/schema";
import { createActivityAction } from "@/app/activity/actions";
import { completeTaskAction, createTaskAction } from "@/app/(app)/tasks/actions";
import { planMeeting } from "@/lib/contacts/meeting";

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
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function addCompanyTaskAction(
  companyKey: string,
  title: string,
  dueAt?: Date,
): Promise<CompanyActionResult> {
  try {
    await createTaskAction({ title, companyKey, dueAt });
    revalidatePath(`/companies/${companyKey}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
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
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function completeCompanyTaskAction(taskId: string, companyKey: string): Promise<CompanyActionResult> {
  try {
    await completeTaskAction(taskId);
    revalidatePath(`/companies/${companyKey}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
