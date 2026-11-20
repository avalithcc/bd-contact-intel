/**
 * The must-list: what the pliego demands that makes a bid inadmissible, as one block the owner pastes to the administrative
 * area. The safety property is unchanged: a requirement the document does not state is reported as not stated, never filled in,
 * and with no document there is no block at all. Fixtures come from the real producer (parseTenderAnalysis).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ToastProvider } from "@/components/ToastProvider";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";
import { ANALYSIS_SYSTEM_PROMPT, parseTenderAnalysis } from "@/lib/tenders/analysis";
import { mustListText } from "@/lib/tenders/mustList";
import type { TenderDetail, TenderDocumentView } from "@/lib/tenders/detail";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TenderFicha } = require("@/app/(app)/licitaciones/[id]/TenderFicha") as typeof import("@/app/(app)/licitaciones/[id]/TenderFicha");

const MODEL_JSON = {
  summary: "Replica de infraestructura en nube publica.",
  viability: "Encaja con trabajo de infraestructura.",
  requirements: {
    registration: "Inscripcion en el registro de proveedores",
    antecedents: null,
    guarantee: "5% de la oferta",
    submissionDeadline: "27/11 14:00",
    certifications: "ISO 27001 vigente (art. 12)",
    financialStanding: null,
    team: "CV de 3 profesionales con titulo universitario",
    affidavits: "Anexo III, declaracion jurada de habilidad",
  },
  economics: { budget: "ARS 12.000.000 (art. 3)", paymentTerms: null, penalties: "1% por dia de demora, tope 10% (art. 21)" },
  pages: 24,
};

const analysisOf = (json: unknown) => parseTenderAnalysis(JSON.stringify(json))!;

test("the four new requirements are parsed, and null stays null (never filled in)", () => {
  const a = analysisOf(MODEL_JSON);
  assert.equal(a.requirements.certifications, "ISO 27001 vigente (art. 12)");
  assert.equal(a.requirements.financialStanding, null);
  assert.equal(a.requirements.team, "CV de 3 profesionales con titulo universitario");
  assert.equal(a.requirements.affidavits, "Anexo III, declaracion jurada de habilidad");
  assert.equal(a.mustListIncluded, true);
});

test("an analysis stored before the must-list existed is recognised: its missing keys were never asked, not 'not stated'", () => {
  const { certifications, financialStanding, team, affidavits, ...legacy } = MODEL_JSON.requirements;
  void certifications; void financialStanding; void team; void affidavits;
  const a = analysisOf({ ...MODEL_JSON, requirements: legacy });
  assert.equal(a.mustListIncluded, false);
});

test("the prompt keeps the null rule verbatim and asks for the four inadmissibility requirements", () => {
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes("Answer ONLY from the attached document. If the document does not say something, say it does not; never infer a requirement."));
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes("Use null for any the document does not state."));
  for (const k of ["certifications", "financialStanding", "team", "affidavits"]) assert.ok(ANALYSIS_SYSTEM_PROMPT.includes(`"${k}"`), k);
});

test("the clipboard text has one line per requirement, what the pliego says, and 'no lo indica' for a null", () => {
  const text = mustListText(analysisOf(MODEL_JSON).requirements, es.tenderDetail, { processNumber: "487-0018-LPR26", name: "Software a medida" });
  const lines = text.split("\n");
  assert.ok(lines[0]!.includes("487-0018-LPR26") && lines[0]!.includes("Software a medida"));
  const body = lines.slice(1).filter((l) => l.startsWith("- "));
  assert.equal(body.length, 8);
  assert.ok(text.includes(`- ${es.tenderDetail.reqCertifications}: ISO 27001 vigente (art. 12)`));
  assert.ok(text.includes(`- ${es.tenderDetail.reqFinancial}: ${es.tenderDetail.reqNotStated}`));
  assert.ok(!text.includes("undefined") && !text.includes("null"));
});

const docWith = (analysis: ReturnType<typeof analysisOf> | null): TenderDocumentView => ({
  id: "d1", filename: "pliego.pdf", sizeBytes: 1000, createdAt: new Date("2026-11-10T10:00:00Z"), uploadedBy: "Ana", analysis, analyzedAt: analysis ? new Date("2026-11-10T10:00:00Z") : null, analyzedBy: analysis ? "Ana" : null,
});

function detail(documents: TenderDocumentView[]): TenderDetail {
  return {
    tender: {
      id: "44444444-4444-4444-8444-444444444444", processNumber: "487-0018-LPR26", fileNumber: "EX-1", name: "Software a medida", processType: "Licitacion Privada",
      openingAt: new Date("2026-12-09T13:00:00Z"), portalStatus: "Publicado", executingUnit: "487", financialAdminService: "105", triageStatus: "a_revisar", note: null,
      aiRelevant: true, aiReason: null, aiClassifiedAt: null, relevanceOverride: null, ownerBdId: null,
      createdAt: new Date("2026-11-01T10:00:00Z"), updatedAt: new Date("2026-11-01T10:00:00Z"), daysLeft: 21, closed: false,
    },
    documents, events: [], bdOptions: [],
  };
}

const actions = { setTriage: async () => {}, saveNote: async () => true, registerDocument: async () => ({ ok: true }), analyse: async () => ({ ok: true as const }), setOwner: async () => {} };
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as never;
const render = (d: TenderDetail) =>
  renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(ToastProvider, null, createElement(TenderFicha, { detail: d, labels: es.tenderDetail, triageLabels: es.tendersPage.triage, actions }))));

test("with a document and a must-list reading the block shows every requirement, 'no lo indica' for the nulls, and a copy button", () => {
  const html = render(detail([docWith(analysisOf(MODEL_JSON))]));
  assert.ok(html.includes(es.tenderDetail.mustTitle));
  for (const label of [es.tenderDetail.reqCertifications, es.tenderDetail.reqFinancial, es.tenderDetail.reqTeam, es.tenderDetail.reqAffidavits]) assert.ok(html.includes(label), label);
  assert.ok(html.includes("ISO 27001 vigente (art. 12)"));
  assert.ok(html.includes(es.tenderDetail.reqNotStated));
  assert.ok(html.includes(es.tenderDetail.mustCopy));
});

test("with NO document there is no must-list block at all, and nothing about certifications is invented", () => {
  const html = render(detail([]));
  assert.ok(!html.includes(es.tenderDetail.mustTitle));
  assert.ok(!html.includes(es.tenderDetail.mustCopy));
  assert.ok(!html.includes(es.tenderDetail.reqCertifications));
  assert.ok(html.includes(es.tenderDetail.noDocTitle));
});

test("a reading from before the must-list asks for a new analysis instead of claiming the pliego does not say", () => {
  const { certifications, financialStanding, team, affidavits, ...legacy } = MODEL_JSON.requirements;
  void certifications; void financialStanding; void team; void affidavits;
  const html = render(detail([docWith(analysisOf({ ...MODEL_JSON, requirements: legacy }))]));
  assert.ok(!html.includes(es.tenderDetail.mustCopy));
  assert.ok(html.includes(es.tenderDetail.mustReanalyse));
});

test("the economics block renders its values, 'not stated' for null, and a legacy reading asks for a new analysis", () => {
  const html = render(detail([docWith(analysisOf(MODEL_JSON))]));
  for (const label of [es.tenderDetail.econBudget, es.tenderDetail.econPayment, es.tenderDetail.econPenalties]) assert.ok(html.includes(label), label);
  assert.ok(html.includes("ARS 12.000.000 (art. 3)"));
  assert.ok(!html.includes(es.tenderDetail.economicsReanalyse));

  const { economics, ...legacy } = MODEL_JSON;
  void economics;
  const old = render(detail([docWith(analysisOf(legacy))]));
  assert.ok(old.includes(es.tenderDetail.economicsReanalyse));
  assert.ok(!old.includes(es.tenderDetail.econBudget));
});

test("both dictionaries carry the new strings and none is a function (the slice crosses a client boundary whole)", () => {
  for (const d of [es, en]) {
    for (const k of ["mustTitle", "mustIntro", "mustCopy", "mustCopied", "mustClipboardHeader", "mustReanalyse", "economicsTitle", "economicsIntro", "economicsReanalyse", "econBudget", "econPayment", "econPenalties", "reqCertifications", "reqFinancial", "reqTeam", "reqAffidavits", "ownerLabel", "ownerNone", "ownerError", "eventOwnerSet", "eventOwnerCleared"] as const) {
      assert.equal(typeof d.tenderDetail[k], "string", k);
    }
  }
});

/**
 * The ficha is INTERNAL CRM copy, so its Spanish is voseo; neutral Spanish is for what goes out to a prospect. The two
 * registers landed side by side twice in this slice - "Analice el pliego de nuevo" was added right under "Analizá el
 * pliego de nuevo" - and nothing failed, because a mixed register is still a valid string. This pins the forms that
 * actually appeared rather than trying to detect register in general: a narrow guard that fires beats a clever one
 * that does not exist.
 */
test("the ficha's Spanish stays voseo: no tuteo/usted forms slipped in beside it", () => {
  const copy = Object.values(es.tenderDetail).filter((v): v is string => typeof v === "string").join("\n");
  for (const form of ["Analice", "Revise", "Valide", "Consulte", "lo dé por", "Analiza el", "Revisa el"]) {
    assert.ok(!copy.includes(form), `tenderDetail uses the non-voseo form "${form}"`);
  }
  // The voseo forms the block is built on are still there, so the guard cannot pass by the strings disappearing.
  assert.ok(copy.includes("Analizá"));
  assert.ok(copy.includes("no lo des por cierto"));
});
