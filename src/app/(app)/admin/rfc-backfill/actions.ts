"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { clampRfcBackfillLimit, rfcBackfillResultToParams } from "@/lib/gmail/rfcBackfill";
import { runRfcBackfill } from "@/lib/gmail/rfcBackfillRun";

/**
 * Runs ONE bounded batch of the Message-ID backfill (the token key only
 * exists in production, so this is the vehicle). The limit is clamped here,
 * server-side: a client-sent `limit` is never trusted beyond the maximum.
 * Redirects with the run summary so the page can render it; the audit row is
 * written by `runRfcBackfill`.
 */
export async function runRfcBackfillAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const limit = clampRfcBackfillLimit(formData.get("limit"));
  const result = await runRfcBackfill({ actorBdId: admin.id, limit });
  revalidatePath("/admin/rfc-backfill");
  redirect(`/admin/rfc-backfill?${rfcBackfillResultToParams(result).toString()}`);
}
