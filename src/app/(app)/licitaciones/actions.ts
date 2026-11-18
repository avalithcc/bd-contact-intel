"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { importTenderFile, type TenderImportReport } from "@/lib/tenders/importFile";
import { MAX_TENDERS_PER_IMPORT, setTenderTriage } from "@/lib/tenders/importDb";
import { TenderSheetError } from "@/lib/tenders/parse";
import { isTenderTriage } from "@/lib/tenders/triage";

/** The portal's export is a few KB; anything near this is not it. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type ImportTendersState =
  | { ok: true; report: TenderImportReport }
  | { ok: false; error: "missingFile" | "tooBig" | "tooMany" | "wrongFile" | "genericFailed"; detail?: string[] }
  | null;

export async function importTendersAction(_prev: ImportTendersState, formData: FormData): Promise<ImportTendersState> {
  // Same session check as every other action: the file and the actor come from the request, the authority from the session.
  const me = await getCurrentBd();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "missingFile" };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "tooBig" };
  try {
    const report = await importTenderFile(Buffer.from(await file.arrayBuffer()), me.id);
    revalidatePath("/licitaciones");
    return { ok: true, report };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof TenderSheetError) return { ok: false, error: "wrongFile", detail: err.detail };
    if (err instanceof Error && err.message.includes(`cap of ${MAX_TENDERS_PER_IMPORT}`)) return { ok: false, error: "tooMany" };
    // The library throws on a file that is not a spreadsheet at all; to the BD that is the same "wrong file".
    if (err instanceof Error && /unsupported|corrupt|not a|bad|invalid|zip|CFB/i.test(err.message)) return { ok: false, error: "wrongFile" };
    console.error("tender import failed", err);
    return { ok: false, error: "genericFailed" };
  }
}

/** A normal action: any signed-in BD may change any tender's triage state (tenders are company-wide, not per BD). */
export async function setTenderTriageAction(id: string, status: string): Promise<void> {
  await getCurrentBd();
  if (!isTenderTriage(status)) throw new Error("Unknown tender state");
  const found = await setTenderTriage(id, status);
  if (!found) throw new Error("Tender not found");
  revalidatePath("/licitaciones");
}
