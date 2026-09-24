"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { approveMigrationRun } from "@/lib/migration/queries";

/**
 * "Approve dry run" (design.md "Migration plan" step 2; admin-access-audit
 * spec "Merges are audit-logged" — this writes the equivalent
 * `migration_approve` audit_log row). Approval does not execute anything by
 * itself; it only unblocks `scripts/unify-contacts.ts --execute` for this
 * specific run id, and only while its `input_hash` still matches.
 */
export async function approveMigrationRunAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const runId = formData.get("runId");
  if (typeof runId !== "string" || !runId) {
    throw new Error("Missing runId");
  }
  await approveMigrationRun(runId, admin.id);
  revalidatePath("/admin/migration");
}
