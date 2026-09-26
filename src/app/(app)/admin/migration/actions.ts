"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { MigrationApproveBlockedError } from "@/lib/migration/approveGuard";
import type { MigrationRunKind } from "@/lib/migration/executionGuard";
import { approveMigrationRun } from "@/lib/migration/queries";

function isMigrationRunKind(v: FormDataEntryValue | null): v is MigrationRunKind {
  return v === "collapse" || v === "fold_leads" || v === "catch_up" || v === "hubspot_import";
}

/**
 * "Approve dry run" (design.md "Migration plan" step 2; admin-access-audit
 * spec "Merges are audit-logged" — this writes the equivalent
 * `migration_approve` audit_log row). Approval does not execute anything by
 * itself; it only unblocks `scripts/unify-contacts.ts --execute` for this
 * specific run id, and only while its `input_hash` still matches.
 *
 * `kind` is a hidden field on the form so `approveMigrationRun` can refuse a
 * mismatch (fresh-review WARNING) — see page.tsx's per-section forms. On a
 * blocked approval, redirects back with `approveError=<reason>` so the page
 * can surface the reason via the `es` dictionary instead of a raw error.
 *
 * `confirmThreshold` is a checkbox present only on the hubspot_import
 * section's form when its dry run is over `HUBSPOT_REVIEW_THRESHOLD`
 * (design D7). `approveMigrationRun` re-checks it server-side regardless of
 * whether the field was even rendered — it is never trusted on its own.
 */
export async function approveMigrationRunAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const runId = formData.get("runId");
  const kind = formData.get("kind");
  const confirmThreshold = formData.get("confirmThreshold") === "on";
  if (typeof runId !== "string" || !runId) {
    throw new Error("Missing runId");
  }
  if (!isMigrationRunKind(kind)) {
    throw new Error("Missing or invalid kind");
  }

  try {
    await approveMigrationRun(runId, admin.id, kind, confirmThreshold);
  } catch (err) {
    if (err instanceof MigrationApproveBlockedError) {
      redirect(`/admin/migration?approveError=${err.reason}`);
    }
    throw err;
  }
  revalidatePath("/admin/migration");
}
