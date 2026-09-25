"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { db } from "@/db";
import { mergeContacts, unmergeContact, markNotDuplicate } from "@/lib/identity/mergeDb";
import { getDuplicateCandidateDetail } from "@/lib/identity/duplicateReviewQueries";

type ActionError = "not_found" | "already_resolved" | "unexpected";

function redirectWithError(err: ActionError): never {
  redirect(`/admin/duplicates?actionError=${err}`);
}

/**
 * "Fusionar en A/B" (task 7.2). The survivor is never taken from client
 * input — it is recomputed server-side via `chooseDefaultSurvivor` (through
 * `getDuplicateCandidateDetail`) so a tampered form field can't pick an
 * unintended survivor. `reason` on the resulting merge_event is the
 * candidate's own match reason (duplicate_candidate.reason, e.g.
 * "name_company"), same vocabulary used everywhere else in the merge trail.
 */
export async function mergeDuplicateCandidateAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const candidateId = formData.get("candidateId");
  if (typeof candidateId !== "string" || !candidateId) throw new Error("Missing candidateId");

  const detail = await getDuplicateCandidateDetail(candidateId);
  if (!detail) redirectWithError("already_resolved");

  const survivorId = detail.recommendedSurvivor === "a" ? detail.personA.id : detail.personB.id;
  const mergedId = detail.recommendedSurvivor === "a" ? detail.personB.id : detail.personA.id;

  try {
    await mergeContacts(db, survivorId, mergedId, detail.reason, admin.id);
  } catch {
    redirectWithError("unexpected");
  }
  revalidatePath("/admin/duplicates");
}

/** "No es duplicado" (task 7.2; duplicate-review spec's not-a-duplicate path). */
export async function markNotDuplicateAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const candidateId = formData.get("candidateId");
  if (typeof candidateId !== "string" || !candidateId) throw new Error("Missing candidateId");

  try {
    await markNotDuplicate(db, candidateId, admin.id);
  } catch {
    redirectWithError("not_found");
  }
  revalidatePath("/admin/duplicates");
}

/** "Deshacer fusión" (task 7.2; duplicate-review spec's unmerge path, no time limit). */
export async function unmergeDuplicateAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const mergeEventId = formData.get("mergeEventId");
  if (typeof mergeEventId !== "string" || !mergeEventId) throw new Error("Missing mergeEventId");

  try {
    await unmergeContact(db, mergeEventId, admin.id);
  } catch {
    redirectWithError("unexpected");
  }
  revalidatePath("/admin/duplicates");
}
