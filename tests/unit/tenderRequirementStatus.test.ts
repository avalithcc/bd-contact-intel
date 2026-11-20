/**
 * The per-requirement answer on the must-list. Three states, not a checkbox: "not asked yet" and "they said no" are opposite
 * facts. Keyed by the stable requirement key, never by the model's text, so a re-analysis cannot lose or move an answer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ToastProvider } from "@/components/ToastProvider";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";
import { parseTenderAnalysis } from "@/lib/tenders/analysis";
import { MUST_LIST_ROWS, mustListLines, mustListText } from "@/lib/tenders/mustList";
import { REQUIREMENT_KEYS, REQUIREMENT_STATUSES, isRequirementKey, isRequirementStatus, statusOf } from "@/lib/tenders/requirementStatus";
import type { TenderDetail, TenderDocumentView } from "@/lib/tenders/detail";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TenderFicha } = require("@/app/(app)/licitaciones/[id]/TenderFicha") as typeof import("@/app/(app)/licitaciones/[id]/TenderFicha");

const MODEL = (certifications: string | null) => ({
  summary: "s", viability: "v",
  requirements: { registration: "R", antecedents: null, guarantee: "5%", submissionDeadline: "27/11", certifications, financialStanding: null, team: "T", affidavits: "A" },
  economics: { budget: null, budgetAmount: null, paymentTerms: null, penalties: null }, pages: 3,
});
const analysisOf = (certifications: string | null) => parseTenderAnalysis(JSON.stringify(MODEL(certifications)))!;

test("the three states are exactly pending, have, missing, and the keys are the eight of the must-list", () => {
  assert.deepEqual([...REQUIREMENT_STATUSES], ["pending", "have", "missing"]);
  assert.deepEqual([...REQUIREMENT_KEYS], MUST_LIST_ROWS.map(([k]) => k));
  assert.ok(isRequirementStatus("have") && !isRequirementStatus("yes") && !isRequirementStatus(undefined));
  assert.ok(isRequirementKey("team") && !isRequirementKey("ISO 27001 vigente") && !isRequirementKey(""));
});

test("a requirement with no stored row is pending, never missing", () => {
  assert.equal(statusOf({}, "team"), "pending");
  assert.equal(statusOf({ team: "missing" }, "team"), "missing");
  assert.equal(statusOf({ team: "have" }, "guarantee"), "pending");
});

test("the clipboard text carries each requirement's status, one line each, pending included", () => {
  const text = mustListText(analysisOf("ISO 27001").requirements, es.tenderDetail, { processNumber: "P-1", name: "N" }, { team: "have", guarantee: "missing" });
  const body = text.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(body.length, 8);
  assert.ok(body.find((l) => l.includes(es.tenderDetail.reqTeam))!.includes(es.tenderDetail.reqStatusHave));
  assert.ok(body.find((l) => l.includes(es.tenderDetail.reqGuarantee))!.includes(es.tenderDetail.reqStatusMissing));
  assert.ok(body.find((l) => l.includes(es.tenderDetail.reqCertifications))!.includes(es.tenderDetail.reqStatusPending));
  assert.ok(body.find((l) => l.includes(es.tenderDetail.reqFinancial))!.includes(es.tenderDetail.reqStatusPending));
});

test("without statuses the clipboard text is unchanged from before", () => {
  const a = mustListText(analysisOf("X").requirements, es.tenderDetail, { processNumber: "P-1", name: "N" });
  assert.ok(!a.includes(es.tenderDetail.reqStatusPending));
});

test("lines are keyed: a re-analysis with other text keeps each answer on the same key", () => {
  const statuses = { certifications: "have" as const };
  const before = mustListLines(analysisOf("ISO 27001").requirements, es.tenderDetail, statuses);
  const after = mustListLines(analysisOf("ISO 9001 y 27001, art. 4").requirements, es.tenderDetail, statuses);
  assert.deepEqual(before.map((l) => [l.key, l.status]), after.map((l) => [l.key, l.status]));
  assert.notEqual(before.find((l) => l.key === "certifications")!.value, after.find((l) => l.key === "certifications")!.value);
  assert.equal(after.find((l) => l.key === "certifications")!.status, "have");
});

const docWith = (analysis: ReturnType<typeof analysisOf>): TenderDocumentView => ({ id: "d1", filename: "p.pdf", sizeBytes: 1, createdAt: new Date("2026-11-10T10:00:00Z"), uploadedBy: null, analysis, analyzedAt: new Date("2026-11-10T10:00:00Z"), analyzedBy: null });
const detail = (a: ReturnType<typeof analysisOf>, requirementStatuses: TenderDetail["requirementStatuses"]): TenderDetail => ({
  tender: { id: "44444444-4444-4444-8444-444444444444", processNumber: "P-1", fileNumber: "E", name: "N", processType: "L", openingAt: new Date("2026-12-09T13:00:00Z"), portalStatus: "P", executingUnit: "1", financialAdminService: "1", triageStatus: "a_revisar", note: null, aiRelevant: true, aiReason: null, aiClassifiedAt: null, relevanceOverride: null, ownerBdId: null, createdAt: new Date(), updatedAt: new Date(), daysLeft: 21, closed: false },
  portal: null, documents: [docWith(a)], events: [], bdOptions: [], requirementStatuses,
});
const calls: [string, string, string][] = [];
const actions = { setTriage: async () => {}, saveNote: async () => true, registerDocument: async () => ({ ok: true }), analyse: async () => ({ ok: true as const }), setOwner: async () => {}, setRequirementStatus: async (id: string, key: string, status: string) => { calls.push([id, key, status]); } };
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as never;
const render = (d: TenderDetail) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(ToastProvider, null, createElement(TenderFicha, { detail: d, labels: es.tenderDetail, triageLabels: es.tendersPage.triage, actions }))));

test("the ficha renders one three-way control per requirement, including the ones the pliego does not state", () => {
  const html = render(detail(analysisOf("ISO"), { team: "have", financialStanding: "missing" }));
  assert.equal(html.split('data-requirement="').length - 1, 8);
  assert.ok(html.includes('data-requirement="financialStanding"'));
  for (const label of [es.tenderDetail.reqStatusPending, es.tenderDetail.reqStatusHave, es.tenderDetail.reqStatusMissing]) assert.ok(html.includes(`>${label}</option>`), label);
  assert.match(html, /<select[^>]*data-requirement="team"[^>]*>(?:(?!<\/select>).)*<option value="have" selected/s);
  assert.match(html, /<select[^>]*data-requirement="guarantee"[^>]*>(?:(?!<\/select>).)*<option value="pending" selected/s);
});

test("the action opens with requireAdmin, is registered in the ficha page and validates before writing", () => {
  const src = readFileSync(join(__dirname, "..", "..", "src/app/(app)/licitaciones/actions.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function setTenderRequirementStatusAction"));
  assert.match(body.split("\n").find((l) => l.includes("requireAdmin"))!, /const me = await requireAdmin\(\);/);
  assert.ok(body.indexOf("requireAdmin") < body.indexOf("isRequirementKey") && body.indexOf("isRequirementKey") < body.indexOf("setRequirementStatus("));
  assert.ok(readFileSync(join(__dirname, "..", "..", "src/app/(app)/licitaciones/[id]/page.tsx"), "utf8").includes("setRequirementStatus: setTenderRequirementStatusAction"));
});

test("both dictionaries carry the strings, all plain strings", () => {
  for (const d of [es, en]) for (const k of ["reqStatusPending", "reqStatusHave", "reqStatusMissing", "reqStatusLabel", "reqStatusError", "eventRequirement"] as const) assert.equal(typeof d.tenderDetail[k], "string", k);
});
