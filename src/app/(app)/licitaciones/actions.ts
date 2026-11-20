"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { importTenderFile, type TenderImportReport } from "@/lib/tenders/importFile";
import { MAX_TENDERS_PER_IMPORT, setTenderTriage } from "@/lib/tenders/importDb";
import { matchesMagic } from "@/lib/email/attachments/magic";
import { createClient } from "@/lib/supabase/server";
import { runTenderAnalysis } from "@/lib/tenders/analyse";
import { MAX_TENDER_DOCUMENT_BYTES, TENDER_DOCUMENTS_BUCKET, checkTenderDocument, tenderDocumentPathBelongsTo } from "@/lib/tenders/document";
import { addTenderDocument, getCurrentTenderDocument, saveTenderAnalysis, saveTenderNote, setRequirementStatus, setTenderOwner } from "@/lib/tenders/workspace";
import { isRequirementKey, isRequirementStatus } from "@/lib/tenders/requirementStatus";
import { isUuid } from "@/lib/uuid";
import { TenderSheetError } from "@/lib/tenders/parse";
import { isTenderTriage } from "@/lib/tenders/triage";
import { isRelevanceChoice } from "@/lib/tenders/relevance";
import { setTenderRelevance } from "@/lib/tenders/relevanceDb";

/** The portal's export is a few KB; anything near this is not it. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type ImportTendersState =
  | { ok: true; report: TenderImportReport }
  | { ok: false; error: "missingFile" | "tooBig" | "tooMany" | "wrongFile" | "genericFailed"; detail?: string[] }
  | null;

export async function importTendersAction(_prev: ImportTendersState, formData: FormData): Promise<ImportTendersState> {
  // Admin-only like the whole section: the file and the actor come from the request, the authority from the session. A non-admin gets AdminRequiredError, never a report.
  const me = await requireAdmin();
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

/** Admin-only (the whole Licitaciones section is). Tenders are company-wide, not per BD. */
export async function setTenderTriageAction(id: string, status: string): Promise<void> {
  const me = await requireAdmin();
  if (!isTenderTriage(status)) throw new Error("Unknown tender state");
  const found = await setTenderTriage(id, status, undefined, me.id);
  if (!found) throw new Error("Tender not found");
  revalidatePath("/licitaciones");
  revalidatePath(`/licitaciones/${id}`);
}

/** An admin may overrule the model on one tender ("auto" gives the decision back to it); the move is logged with who made it. */
export async function setTenderRelevanceAction(id: string, choice: string): Promise<void> {
  const me = await requireAdmin();
  if (!isRelevanceChoice(choice)) throw new Error("Unknown relevance choice");
  const found = await setTenderRelevance(id, choice, undefined, me.id);
  if (!found) throw new Error("Tender not found");
  revalidatePath("/licitaciones");
  revalidatePath(`/licitaciones/${id}`);
}

/** An admin may assign a tender to an admin, or release it with an empty value (the write refuses a non-admin owner); the move is logged with who made it. */
export async function setTenderOwnerAction(id: string, ownerBdId: string): Promise<void> {
  const me = await requireAdmin();
  const found = await setTenderOwner(id, ownerBdId === "" ? null : ownerBdId, me.id);
  if (!found) throw new Error("Tender or BD not found");
  revalidatePath("/licitaciones");
  revalidatePath(`/licitaciones/${id}`);
}

/**
 * An admin records what administration answered for one requirement: the status, its short note, or both. An absent field is
 * left alone (the two are independent); pending with no note clears the row. The move is logged with who made it.
 */
export async function setTenderRequirementStatusAction(id: string, key: string, status: string | undefined, note?: string): Promise<void> {
  const me = await requireAdmin();
  if (!isRequirementKey(key) || (status !== undefined && !isRequirementStatus(status)) || (note !== undefined && typeof note !== "string")) throw new Error("Unknown requirement or state");
  const found = await setRequirementStatus(id, key, { status, note }, me.id);
  if (!found) throw new Error("Tender not found");
  revalidatePath(`/licitaciones/${id}`);
}

/** An admin may edit the one shared note; the change is logged with who made it. */
export async function saveTenderNoteAction(id: string, text: string): Promise<boolean> {
  const me = await requireAdmin();
  const found = await saveTenderNote(id, typeof text === "string" ? text : "", me.id);
  if (found) revalidatePath(`/licitaciones/${id}`);
  return found;
}

/**
 * The browser already put the file in the bucket; this records it. Nothing the client says is trusted: the type and size
 * are re-checked and the path must sit inside the caller's own folder, as for the email attachments.
 */
export async function registerTenderDocumentAction(input: { tenderId: string; storagePath: string; filename: string; size: number }): Promise<{ ok: boolean }> {
  const me = await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || typeof input?.storagePath !== "string" || !tenderDocumentPathBelongsTo(input.storagePath, data.user.id)) return { ok: false };
  if (typeof input.filename !== "string" || !checkTenderDocument({ filename: input.filename, contentType: "application/pdf", size: Number(input.size) }).ok) return { ok: false };
  const id = await addTenderDocument({ tenderId: input.tenderId, storagePath: input.storagePath, filename: input.filename, sizeBytes: Number(input.size), actorBdId: me.id });
  if (!id) return { ok: false };
  revalidatePath(`/licitaciones/${input.tenderId}`);
  return { ok: true };
}

export type AnalyseTenderResult = { ok: true } | { ok: false; error: "noDocument" | "notPdf" | "tooLarge" | "download" | "gatewayNotConfigured" | "generationFailed" | "invalidModelOutput" };

/**
 * Reads the tender's CURRENT pliego and stores the reading on that document. With no document there is nothing to read and
 * the answer is "noDocument": the reading is never made from the title. The file is downloaded with the caller's own
 * session (the bucket lets any signed-in user read, but only an admin reaches this action), and its first bytes are checked to really be a PDF.
 */
export async function analyseTenderAction(tenderId: string): Promise<AnalyseTenderResult> {
  const me = await requireAdmin();
  if (!isUuid(tenderId)) return { ok: false, error: "noDocument" };
  const doc = await getCurrentTenderDocument(tenderId);
  if (!doc) return { ok: false, error: "noDocument" };
  if (doc.sizeBytes > MAX_TENDER_DOCUMENT_BYTES) return { ok: false, error: "tooLarge" };
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(TENDER_DOCUMENTS_BUCKET).download(doc.storagePath);
  if (error || !data) return { ok: false, error: "download" };
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length > MAX_TENDER_DOCUMENT_BYTES) return { ok: false, error: "tooLarge" };
  if (!matchesMagic("pdf", bytes)) return { ok: false, error: "notPdf" };
  const result = await runTenderAnalysis(bytes, doc.filename);
  if (!result.ok) return { ok: false, error: result.error };
  // Stored on the document that was read, so an upload that landed meanwhile does not inherit it.
  if (!(await saveTenderAnalysis(doc.id, result.analysis, me.id))) return { ok: false, error: "noDocument" };
  revalidatePath(`/licitaciones/${tenderId}`);
  return { ok: true };
}
