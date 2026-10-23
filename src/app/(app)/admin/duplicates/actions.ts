"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { db } from "@/db";
import { mergeContacts, unmergeContact, markNotDuplicate } from "@/lib/identity/mergeDb";
import { getDuplicateCandidateDetail } from "@/lib/identity/duplicateReviewQueries";
import { clampRescanCap, rescanReportToParams } from "@/lib/identity/duplicateRescan";
import { runDuplicateRescan } from "@/lib/identity/duplicateRescanRun";
import { cancelScheduledSend, SequenceMergeBlockedError } from "@/lib/sequences/mergeQueries";

type ActionError = "not_found" | "already_resolved" | "unexpected" | "sequence_blocked";

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
    await mergeContacts(db, survivorId, mergedId, detail.reason, admin.id, {
      acknowledgeSequences: formData.get("acknowledgeSequences") === "on",
    });
  } catch (err) {
    unstable_rethrow(err);
    // Sequence memberships stop the merge (scheduled send, or unacknowledged); see src/lib/sequences/mergePlan.ts.
    if (err instanceof SequenceMergeBlockedError) redirectWithError("sequence_blocked");
    redirectWithError("unexpected");
  }
  revalidatePath("/admin/duplicates");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Cancelar envio" for a Sequence member whose scheduled send blocks a merge. When the panel passes its candidate, the
 * BD lands back on it with `sendCancelled=1` so the panel can confirm the cancellation (mockup state 2).
 */
export async function cancelScheduledSendAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const memberId = formData.get("memberId");
  if (typeof memberId !== "string" || !memberId) throw new Error("Missing memberId");
  const cancelled = await cancelScheduledSend(db, memberId);
  revalidatePath("/admin/duplicates");
  const candidateId = formData.get("candidateId");
  if (typeof candidateId === "string" && UUID_RE.test(candidateId)) {
    redirect(`/admin/duplicates?candidate=${candidateId}${cancelled ? "&sendCancelled=1" : ""}`);
  }
}

/** "No es duplicado" (task 7.2; duplicate-review spec's not-a-duplicate path). */
export async function markNotDuplicateAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const candidateId = formData.get("candidateId");
  if (typeof candidateId !== "string" || !candidateId) throw new Error("Missing candidateId");

  try {
    await markNotDuplicate(db, candidateId, admin.id);
  } catch (err) {
    unstable_rethrow(err);
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
  } catch (err) {
    unstable_rethrow(err);
    redirectWithError("unexpected");
  }
  revalidatePath("/admin/duplicates");
}

/**
 * "Re-escanear": the manual twin of /api/duplicates/rescan (same code path). The cap is clamped here,
 * server-side; `dryRun` defaults to ON unless the checkbox was cleared. The audit row (real runs only)
 * is written by `runDuplicateRescan` with `trigger: "manual"` and this admin as actor.
 */
export async function runDuplicateRescanAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const report = await runDuplicateRescan(db, {
    dryRun: formData.get("dryRun") === "on",
    trigger: "manual",
    actorBdId: admin.id,
    cap: clampRescanCap(formData.get("cap")),
  });
  revalidatePath("/admin/duplicates");
  redirect(`/admin/duplicates?${rescanReportToParams(report).toString()}`);
}
