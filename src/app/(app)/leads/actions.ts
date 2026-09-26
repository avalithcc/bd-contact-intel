"use server";

import { revalidatePath } from "next/cache";
import { buildLeadDrafts, type LeadCsvBundle } from "@/lib/leads/csv";
import { importLeads } from "@/lib/leads/queries";
import { getCurrentBd } from "@/lib/queries";
import type { IdentityIngestReport } from "@/lib/identity/ingestWrite";

// Stable keys, not translated text — server actions must not decide the
// visitor's language (see src/app/actions.ts for the same convention).
export type ImportLeadsErrorKey = "missingSourceKey" | "missingFiles" | "genericFailed";

export interface ImportLeadsResult {
  ok: boolean;
  upserted?: number;
  matchedOwners?: string[];
  unmatchedOwners?: string[];
  // Dedup outcome from the identity resolver (task 14.2's `/contacts/import`
  // outcome summary) — null when IDENTITY_DUAL_WRITE is off.
  identityReport?: IdentityIngestReport | null;
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
    revalidatePath("/contacts");
    return {
      ok: true,
      upserted: result.upserted,
      matchedOwners: result.matchedOwners,
      unmatchedOwners: result.unmatchedOwners,
      identityReport: result.identityReport,
    };
  } catch (err) {
    return {
      ok: false,
      errorKey: "genericFailed",
      errorDetail: err instanceof Error ? err.message : undefined,
    };
  }
}

// updateLeadStatusAction/updateLeadOwnerAction/draftLeadEmailAction/
// sendLeadEmailAction (the /leads/[id] lead-detail actions) were removed
// here (task 13.3): that page is redirect-only since task 11.4, so these
// had no remaining callers — verified with `rg` — no remaining importers,
// same convention as task 11.6's ManualSignal.tsx/EmailComposer.tsx removal.
// The underlying data layer (updateLeadOwner/updateLeadStatus/getLeadById in
// src/lib/leads/queries.ts) is untouched; /contacts/[id]'s equivalents
// (updateContactOwnerAction, the board's log dialogs, "Generar mensaje",
// QuickActions "Correo") cover the same ground on the unified record page.
