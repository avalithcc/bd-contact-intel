"use server";

import { revalidatePath } from "next/cache";
import { buildLeadDrafts, type LeadCsvBundle } from "@/lib/leads/csv";
import { importLeads, updateLeadOwner, updateLeadStatus } from "@/lib/leads/queries";
import { getCurrentBd } from "@/lib/queries";
import { isLeadStatusKey, type LeadStatusKey } from "@/lib/leads/types";

// Stable keys, not translated text — server actions must not decide the
// visitor's language (see src/app/actions.ts for the same convention).
export type ImportLeadsErrorKey = "missingSourceKey" | "missingFiles" | "genericFailed";

export interface ImportLeadsResult {
  ok: boolean;
  upserted?: number;
  matchedOwners?: string[];
  unmatchedOwners?: string[];
  errorKey?: ImportLeadsErrorKey;
  errorDetail?: string;
}

async function fileText(formData: FormData, field: string): Promise<string | undefined> {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) return undefined;
  return file.text();
}

/**
 * Import server action backing the /leads upload control (see
 * UploadLeadsForm.tsx). All the source files are small (a few hundred KB at
 * most), well under a server action's request body cap, so — unlike
 * messages.csv (see src/app/actions.ts#uploadMessagesCsv) — this does not
 * need the Supabase Storage indirection.
 */
export async function importLeadsCsv(
  _prev: ImportLeadsResult | null,
  formData: FormData,
): Promise<ImportLeadsResult> {
  // Writes to shared team data, so it verifies the session itself rather
  // than relying on middleware alone (throws when not authenticated).
  await getCurrentBd();
  const sourceKey = String(formData.get("sourceKey") ?? "").trim();
  const sourceName = String(formData.get("sourceName") ?? "").trim() || sourceKey;
  if (!sourceKey) return { ok: false, errorKey: "missingSourceKey" };

  try {
    const bundle: LeadCsvBundle = {
      attendees: await fileText(formData, "attendees"),
      decisores: await fileText(formData, "decisores"),
      hunter: await fileText(formData, "hunter"),
      probables: await fileText(formData, "probables"),
      correosFinal: await fileText(formData, "correosFinal"),
      columnaCorreos: await fileText(formData, "columnaCorreos"),
    };
    const hasAnyFile = Object.values(bundle).some((v) => v !== undefined);
    if (!hasAnyFile) return { ok: false, errorKey: "missingFiles" };

    const drafts = buildLeadDrafts(bundle);
    const result = await importLeads(sourceKey, sourceName, drafts);
    revalidatePath("/leads");
    return {
      ok: true,
      upserted: result.upserted,
      matchedOwners: result.matchedOwners,
      unmatchedOwners: result.unmatchedOwners,
    };
  } catch (err) {
    return {
      ok: false,
      errorKey: "genericFailed",
      errorDetail: err instanceof Error ? err.message : undefined,
    };
  }
}

export interface UpdateLeadStatusResult {
  ok: boolean;
  errorDetail?: string;
}

/** Any signed-in BD may edit a lead's status/notes — leads are shared, not per-BD. */
export async function updateLeadStatusAction(
  leadId: string,
  fields: { status?: string; notes?: string },
): Promise<UpdateLeadStatusResult> {
  try {
    const me = await getCurrentBd();
    const status: LeadStatusKey | undefined = isLeadStatusKey(fields.status)
      ? fields.status
      : undefined;
    await updateLeadStatus(leadId, me.id, { status, notes: fields.notes });
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    return { ok: false, errorDetail: err instanceof Error ? err.message : undefined };
  }
}

/** Any signed-in BD may reassign a lead's owner. `ownerBdId` empty/null = unassign. */
export async function updateLeadOwnerAction(
  leadId: string,
  ownerBdId: string | null,
): Promise<UpdateLeadStatusResult> {
  try {
    const me = await getCurrentBd();
    await updateLeadOwner(leadId, me.id, ownerBdId || null);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    return { ok: false, errorDetail: err instanceof Error ? err.message : undefined };
  }
}
