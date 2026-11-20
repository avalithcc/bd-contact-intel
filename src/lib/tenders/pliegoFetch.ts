/**
 * Downloads one tender's pliego (the particular clauses) from COMPR.AR's PUBLIC citizen view: the same walk as portalFetch.ts,
 * plus one more postback on the citizen page, whose answer is the PDF itself. Never throws: every failure is an outcome, so one
 * tender cannot fail a run. It only DOWNLOADS: reading the document is a separate, human-triggered step and is not reachable from here.
 */
import { MAX_TENDER_DOCUMENT_BYTES } from "@/lib/tenders/document";
import { matchesMagic } from "@/lib/email/attachments/magic";
import { PORTAL_TENDER_TIMEOUT_MS, fail, newSession, openCitizenView, postback, send } from "@/lib/tenders/portalFetch";
import { parsePliegoTarget } from "@/lib/tenders/portalParse";

/** The tender's whole exchange, the PDF included (about 800 KB). */
export const PLIEGO_TENDER_TIMEOUT_MS = PORTAL_TENDER_TIMEOUT_MS + 7_000;

export type PliegoOutcome =
  | { kind: "ok"; bytes: Uint8Array; filename: string }
  | { kind: "not_found" }
  | { kind: "no_document" }
  | { kind: "not_pdf" }
  | { kind: "too_large" }
  | { kind: "error"; message: string };

/** The portal's own file name when it is a plain .pdf, otherwise a name built from the process number. */
export function pliegoFilename(contentDisposition: string | null, processNumber: string): string {
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition ?? "")?.[1]?.trim();
  if (named && /\.pdf$/i.test(named) && named.length <= 200) return named;
  return `pliego-${processNumber.replace(/[^A-Za-z0-9-]/g, "_")}.pdf`;
}

export async function fetchPliegoPdf(processNumber: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<PliegoOutcome> {
  const session = newSession(opts.fetchImpl, opts.timeoutMs ?? PLIEGO_TENDER_TIMEOUT_MS);
  try {
    const view = await openCitizenView(session, processNumber);
    if (view.kind === "not_found") return view;
    const target = parsePliegoTarget(view.html);
    if (!target) return { kind: "no_document" };
    const state = view.state ?? fail("no_form_state");

    const { res } = await send(session, view.url, postback(state, target), "application/pdf");
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_TENDER_DOCUMENT_BYTES) {
      await res.body?.cancel();
      return { kind: "too_large" };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_TENDER_DOCUMENT_BYTES) return { kind: "too_large" };
    if (!matchesMagic("pdf", bytes)) return { kind: "not_pdf" };
    return { kind: "ok", bytes, filename: pliegoFilename(res.headers.get("content-disposition"), processNumber) };
  } catch (err) {
    return { kind: "error", message: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}
