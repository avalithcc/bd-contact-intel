"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boardCandidate } from "@/db/schema";
import { getCurrentBd } from "@/lib/queries";
import { approveAsTargetCompany } from "@/lib/hiring/discovery";

/**
 * Approves a pending board candidate: marks it 'approved' (decidedBy is the
 * signed-in BD's email, never client-supplied) and upserts the matching
 * target_company row so the existing daily sync picks it up with no extra
 * wiring (see approveAsTargetCompany). A no-op if the candidate is already
 * decided (approved/auto_approved/rejected) or missing — guards against a
 * stale queue re-submitting the same form twice.
 */
export async function approveCandidate(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;

  const me = await getCurrentBd();

  const candidate = await db.query.boardCandidate.findFirst({
    where: eq(boardCandidate.id, id),
  });
  if (!candidate || candidate.status !== "pending") return;

  await db
    .update(boardCandidate)
    .set({ status: "approved", decidedAt: new Date(), decidedBy: me.email })
    .where(eq(boardCandidate.id, id));

  await approveAsTargetCompany(
    candidate.companyKey,
    candidate.displayName,
    candidate.ats,
    candidate.slug,
  );

  revalidatePath("/discovery");
}

/**
 * Rejects a pending board candidate: marks it 'rejected' (decidedBy is the
 * signed-in BD's email). Never touches target_company — rejecting a
 * candidate only removes it from the review queue.
 */
export async function rejectCandidate(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;

  const me = await getCurrentBd();

  const candidate = await db.query.boardCandidate.findFirst({
    where: eq(boardCandidate.id, id),
  });
  if (!candidate || candidate.status !== "pending") return;

  await db
    .update(boardCandidate)
    .set({ status: "rejected", decidedAt: new Date(), decidedBy: me.email })
    .where(eq(boardCandidate.id, id));

  revalidatePath("/discovery");
}
