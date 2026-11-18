/**
 * The tender ficha: the pliego policy, the analysis parsing, which analysis counts, and the rendered page. The page is
 * rendered with renderToStaticMarkup over the pure view; the actions are fakes, so nothing here touches a database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ToastProvider } from "@/components/ToastProvider";
import { es } from "@/lib/i18n/dictionaries/es";
import { MAX_TENDER_DOCUMENT_BYTES, checkTenderDocument, tenderDocumentPath, tenderDocumentPathBelongsTo } from "@/lib/tenders/document";
import { canAnalyse, currentDocument, parseTenderAnalysis, type TenderAnalysis } from "@/lib/tenders/analysis";
import type { TenderDetail, TenderDocumentView, TenderEventView } from "@/lib/tenders/detail";
import { normalizeNote } from "@/lib/tenders/note";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TenderFicha } = require("@/app/(app)/licitaciones/[id]/TenderFicha") as typeof import("@/app/(app)/licitaciones/[id]/TenderFicha");

const UID = "11111111-1111-4111-8111-111111111111";

test("a pliego must be a PDF within 20 MB and non-empty; anything else is refused with its reason", () => {
  assert.deepEqual(checkTenderDocument({ filename: "pliego.PDF", contentType: "application/pdf", size: 1000 }), { ok: true });
  assert.deepEqual(checkTenderDocument({ filename: "pliego.pdf", contentType: "", size: 1000 }), { ok: true });
  assert.equal(checkTenderDocument({ filename: "pliego.docx", contentType: "application/pdf", size: 10 }).ok, false);
  assert.deepEqual(checkTenderDocument({ filename: "a.pdf", contentType: "text/html", size: 10 }), { ok: false, reason: "type_not_allowed" });
  assert.deepEqual(checkTenderDocument({ filename: "a.pdf", contentType: "application/pdf", size: 0 }), { ok: false, reason: "empty" });
  assert.deepEqual(checkTenderDocument({ filename: "a.pdf", contentType: "application/pdf", size: MAX_TENDER_DOCUMENT_BYTES + 1 }), { ok: false, reason: "too_large" });
});

test("the storage path is the uploader's own folder and a tampered path never matches", () => {
  const path = tenderDocumentPath(UID, "22222222-2222-4222-8222-222222222222", "Pliego Ñandú (v2).pdf");
  assert.ok(tenderDocumentPathBelongsTo(path, UID));
  assert.ok(!tenderDocumentPathBelongsTo(path, "33333333-3333-4333-8333-333333333333"));
  assert.ok(!tenderDocumentPathBelongsTo(`${UID}/../x.pdf`, UID));
});

test("a note is trimmed, bounded, and blank means no note", () => {
  assert.equal(normalizeNote("   "), null);
  assert.equal(normalizeNote("  hola  "), "hola");
  assert.equal(normalizeNote("x".repeat(6000))!.length, 5000);
});

const ANALYSIS: TenderAnalysis = {
  summary: "Replica de infraestructura critica en nube publica.",
  viability: "Encaja con trabajo de infraestructura.",
  requirements: { registration: "Inscripcion en el registro", antecedents: null, guarantee: "5%", submissionDeadline: "27/11 14:00" },
  pages: 24,
};

test("the model's JSON is accepted bare or fenced, and refused when the summary or viability is missing", () => {
  const raw = JSON.stringify(ANALYSIS);
  assert.deepEqual(parseTenderAnalysis(raw), ANALYSIS);
  assert.deepEqual(parseTenderAnalysis("```json\n" + raw + "\n```"), ANALYSIS);
  assert.equal(parseTenderAnalysis("no json here"), null);
  assert.equal(parseTenderAnalysis(JSON.stringify({ ...ANALYSIS, viability: "" })), null);
  assert.equal(parseTenderAnalysis("{ truncated"), null);
});

const doc = (id: string, createdAt: string, analysis: TenderAnalysis | null = null): TenderDocumentView => ({
  id, filename: `${id}.pdf`, sizeBytes: 2_500_000, createdAt: new Date(createdAt), uploadedBy: "Ana", analysis, analyzedAt: analysis ? new Date(createdAt) : null, analyzedBy: analysis ? "Ana" : null,
});

test("the current document is the newest upload and analysing needs one", () => {
  const docs = [doc("old", "2026-11-01T10:00:00Z", ANALYSIS), doc("new", "2026-11-10T10:00:00Z")];
  assert.equal(currentDocument(docs)?.id, "new");
  assert.equal(currentDocument([]), null);
  assert.equal(canAnalyse(null), false);
  assert.equal(canAnalyse(docs[1]!), true);
});

function detail(over: { documents?: TenderDocumentView[]; events?: TenderEventView[]; note?: string | null } = {}): TenderDetail {
  return {
    tender: {
      id: "44444444-4444-4444-8444-444444444444",
      processNumber: "487-0018-LPR26",
      fileNumber: "EX-2026-000123-APN",
      name: "Servicio de desarrollo de software a medida",
      processType: "Licitacion Privada",
      openingAt: new Date("2026-12-09T13:00:00Z"),
      portalStatus: "Publicado",
      executingUnit: "487 - Compras",
      financialAdminService: "105 - Organismo de Prueba",
      triageStatus: "en_analisis",
      note: over.note ?? null,
      createdAt: new Date("2026-11-01T10:00:00Z"),
      updatedAt: new Date("2026-11-01T10:00:00Z"),
      daysLeft: 21,
      closed: false,
    },
    documents: over.documents ?? [],
    events: over.events ?? [],
  };
}

const actions = { setTriage: async () => {}, saveNote: async () => true, registerDocument: async () => ({ ok: true }), analyse: async () => ({ ok: true as const }) };
// The controls call useRouter().refresh() after a write; a stub router is enough to render them.
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as never;
const render = (d: TenderDetail) =>
  renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router }, createElement(ToastProvider, null, createElement(TenderFicha, { detail: d, labels: es.tenderDetail, triageLabels: es.tendersPage.triage, actions }))),
  );
const analyseButton = (html: string) => new RegExp(`<button[^>]*>[^<]*${es.tenderDetail.analyse}[^<]*</button>`).exec(html)?.[0] ?? "";

test("the ficha renders every stored field, with the process number as copyable text and a portal link that is not a deep link", () => {
  const html = render(detail());
  for (const v of ["487-0018-LPR26", "EX-2026-000123-APN", "Servicio de desarrollo de software a medida", "Licitacion Privada", "Publicado", "487 - Compras", "105 - Organismo de Prueba", "9 dic 2026, 10:00"]) {
    assert.ok(html.includes(v), `missing ${v}`);
  }
  assert.ok(html.includes(es.tenderDetail.copy));
  // The SEARCH page, not the site root: it carries the "Número de proceso" box, so the BD lands where the number they
  // just copied is usable. Still not a deep link - COMPR.AR has none, its process links are __doPostBack - and the
  // assertion below pins that, so a future "improvement" that invents a per-tender URL fails here.
  assert.ok(html.includes('href="https://comprar.gob.ar/BuscarAvanzado.aspx"'), "the portal link must be the search page");
  assert.doesNotMatch(html, new RegExp(`comprar\\.gob\\.ar[^"]*487-0018-LPR26`), "a per-tender portal URL cannot exist and must not be invented");
});

test("a tender with no note and no document renders without a document line, a reading or a log entry, and says why analysis is off", () => {
  const html = render(detail());
  assert.ok(html.includes(es.tenderDetail.noDocTitle));
  assert.ok(!html.includes(es.tenderDetail.analysisSummary));
  assert.ok(!html.includes(es.tenderDetail.analysisPending));
  assert.ok(!html.includes("MB,"), "no document line");
  assert.ok(html.includes(es.tenderDetail.logEmpty));
  assert.ok(/<textarea[^>]*><\/textarea>/.test(html), "the note field is empty, not prefilled");
});

test("the analyse control is unavailable with no document and available with one", () => {
  assert.ok(/disabled/.test(analyseButton(render(detail()))), "disabled without a document");
  const withDoc = analyseButton(render(detail({ documents: [doc("a", "2026-11-10T10:00:00Z")] })));
  assert.ok(withDoc.length > 0);
  assert.ok(!/disabled/.test(withDoc), "enabled with a document");
});

test("an analysis belongs to the document it read: a newer upload without one does not show the old reading", () => {
  const html = render(detail({ documents: [doc("new", "2026-11-12T10:00:00Z"), doc("old", "2026-11-01T10:00:00Z", ANALYSIS)] }));
  assert.ok(!html.includes(ANALYSIS.summary));
  assert.ok(html.includes(es.tenderDetail.analysisPending));
  const same = render(detail({ documents: [doc("old", "2026-11-01T10:00:00Z", ANALYSIS)] }));
  assert.ok(same.includes(ANALYSIS.summary) && same.includes("Inscripcion en el registro") && same.includes(es.tenderDetail.reqNotStated));
});

test("the progress log shows who and when for a note, a state change, an upload and an analysis", () => {
  const ev = (id: string, kind: TenderEventView["kind"], detail: TenderEventView["detail"], at: string): TenderEventView => ({ id, kind, detail, createdAt: new Date(at), actor: "Ana" });
  const html = render(
    detail({
      note: "Llamar al organismo",
      events: [
        ev("1", "note", { text: "Llamar al organismo" }, "2026-11-12T13:00:00Z"),
        ev("2", "triage", { from: "a_revisar", to: "en_analisis" }, "2026-11-11T13:00:00Z"),
        ev("3", "document", { filename: "pliego.pdf" }, "2026-11-10T13:00:00Z"),
        ev("4", "analysis", { filename: "pliego.pdf" }, "2026-11-10T14:00:00Z"),
      ],
    }),
  );
  assert.ok(html.includes("Llamar al organismo"));
  assert.ok(html.includes("Cambió el estado de A revisar a En análisis"));
  assert.ok(html.includes("Subió el pliego pliego.pdf") && html.includes("Analizó el pliego pliego.pdf"));
  assert.ok(html.includes("Ana, 12 nov 2026, 10:00"));
});
