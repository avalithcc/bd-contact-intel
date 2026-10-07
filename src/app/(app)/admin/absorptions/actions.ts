"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { isUuid } from "@/lib/uuid";
import { executeMerge } from "@/lib/companyMerge/db";
import { ProposalNotOpenError } from "@/lib/companyMerge/proposals";
import { readProposalForResolution, rejectAbsorption } from "@/lib/companies/absorptionDb";
import { blockerDetail, decideApply, type ReviewCode } from "@/lib/companies/absorptionReview";

function back(code: ReviewCode, detail?: string): never {
  const q = new URLSearchParams({ result: code });
  if (detail) q.set("detail", detail);
  redirect(`/admin/absorptions?${q}`);
}

const proposalId = (formData: FormData): string | null => {
  const raw = formData.get("proposalId");
  return typeof raw === "string" && isUuid(raw) ? raw : null;
};

/**
 * "Aplicar la fusión". Everything that decides what gets merged is read here, not posted: the proposal is re-read,
 * must still be open, and the typed name is compared with the absorbed company's live name. executeMerge marks the
 * proposal applied inside its own transaction (before it deletes the absorbed row), so this action writes nothing else.
 * executeMerge re-checks inside its own transaction that this proposal is still open (a rejection landing after the
 * read above is refused there, before any write). It THROWS on blockers; that is caught and handed back as a refusal the owner can read, never a 500.
 */
export async function applyAbsorptionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = proposalId(formData);
  if (!id) back("invalid_id");

  const decision = decideApply(await readProposalForResolution(id), formData.get("confirmName"));
  if (!decision.ok) back(decision.code);

  try {
    await executeMerge([decision.group], admin.id, id);
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ProposalNotOpenError) back("not_open");
    const detail = blockerDetail(err);
    if (detail !== null) back("blocked", detail);
    console.error("absorption apply failed", id, err);
    back("failed");
  }
  back("applied");
}

/** "Rechazar": open -> rejected, guarded by the UPDATE's own `status = 'open'`. */
export async function rejectAbsorptionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = proposalId(formData);
  if (!id) back("invalid_id");
  back((await rejectAbsorption(id, admin.id)) ? "rejected" : "not_open");
}
