import assert from "node:assert/strict";
import { test } from "node:test";
import { planOpeningCorrection } from "@/lib/tenders/openingCorrection";
import { runPortalFetch, type PortalCandidate, type PortalOutcome, type PortalRunDeps } from "@/lib/tenders/portalRun";

const crm = new Date("2026-11-24T14:00:00Z");
const moved = new Date("2026-12-01T14:00:00Z");

test("a differing portal date is a correction carrying the old and the new instant", () => {
  assert.deepEqual(planOpeningCorrection(crm, moved), { from: crm, to: moved });
});

test("the symmetric case, a date brought FORWARD, is corrected too", () => {
  const earlier = new Date("2026-11-22T14:00:00Z");
  assert.deepEqual(planOpeningCorrection(crm, earlier), { from: crm, to: earlier });
});

test("instants are compared, not objects or strings: an equal instant from another Date is no change", () => {
  assert.equal(planOpeningCorrection(crm, new Date(crm.getTime())), null);
  assert.equal(planOpeningCorrection(new Date("2026-11-24T14:00:00Z"), new Date("2026-11-24T11:00:00-03:00")), null);
});

test("a null or invalid portal date changes nothing", () => {
  assert.equal(planOpeningCorrection(crm, null), null);
  assert.equal(planOpeningCorrection(crm, new Date("nope")), null);
});

test("the planner is pure: same input twice gives the same plan and neither input is mutated", () => {
  const a = new Date(crm.getTime());
  const b = new Date(moved.getTime());
  const first = planOpeningCorrection(a, b);
  const second = planOpeningCorrection(a, b);
  assert.deepEqual(first, second);
  assert.equal(a.getTime(), crm.getTime());
  assert.equal(b.getTime(), moved.getTime());
  assert.notEqual(first!.to, b, "the plan holds a copy, so a later mutation of the input cannot reach it");
});

// ---- inside the run ----

const okWith = (openingAt: Date | null): PortalOutcome => ({ kind: "ok", portalUrl: "u", fields: { objeto: "o", currency: null, contractDuration: null, offerValidity: null, acceptsExtension: null, questionsUntil: null, openingAt, guaranteeOffer: null, guaranteeContract: null, guaranteeChallenge: null, circularCount: 0 } });

function run(outcome: PortalOutcome, over: Partial<PortalRunDeps> = {}) {
  const applied: { id: string; from: Date | null; to: Date }[] = [];
  const rows: PortalCandidate[] = [{ id: "t1", processNumber: "P-1", openingAt: crm }];
  const d: PortalRunDeps = {
    clock: () => 1,
    sleep: async () => {},
    selectDue: async () => ({ rows, total: 1 }),
    fetchOne: async () => outcome,
    save: async () => {},
    applyOpening: async (c, plan) => (applied.push({ id: c.id, ...plan }), true),
    ...over,
  };
  return { d, applied };
}

test("a differing date updates and logs once, a second identical run writes nothing more", async () => {
  const { d, applied } = run(okWith(moved));
  const r = await runPortalFetch(d);
  assert.equal(r.openingMoved, 1);
  assert.deepEqual(applied, [{ id: "t1", from: crm, to: moved }]);
});

test("an equal date writes nothing: zero events on unchanged tenders", async () => {
  const { d, applied } = run(okWith(new Date(crm.getTime())));
  assert.equal((await runPortalFetch(d)).openingMoved, 0);
  assert.equal(applied.length, 0);
});

test("a null portal date, a failed fetch and a not-found change nothing", async () => {
  for (const o of [okWith(null), { kind: "error", message: "x" } as PortalOutcome, { kind: "not_found" } as PortalOutcome]) {
    const { d, applied } = run(o);
    assert.equal((await runPortalFetch(d)).openingMoved, 0);
    assert.equal(applied.length, 0);
  }
});

test("a correction that throws does not fail the run or un-count the fetch", async () => {
  const { d } = run(okWith(moved), { applyOpening: async () => { throw new Error("db down"); } });
  const r = await runPortalFetch(d);
  assert.equal(r.fetched, 1);
  assert.equal(r.openingMoved, 0);
});

test("no correction is attempted when the portal row itself could not be saved", async () => {
  const { d, applied } = run(okWith(moved), { save: async () => { throw new Error("db down"); } });
  await runPortalFetch(d);
  assert.equal(applied.length, 0);
});

// ---- the ficha ----

import React from "react";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";
import type { TenderEventView } from "@/lib/tenders/detail";
(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { eventText } = require("@/app/(app)/licitaciones/[id]/TenderFicha") as typeof import("@/app/(app)/licitaciones/[id]/TenderFicha");

const event: TenderEventView = { id: "e1", kind: "opening", detail: { from: "2026-11-24T14:00:00+00:00", to: "2026-12-01T14:00:00+00:00" }, createdAt: new Date("2026-11-20T09:00:00Z"), actor: null };

test("the ficha reads the move in both languages, in Argentina time, with no second person", () => {
  assert.equal(eventText(event, es.tenderDetail, es.tendersPage.triage), "La apertura se movió del 24 nov 2026, 11:00 al 1 dic 2026, 11:00");
  assert.equal(eventText(event, en.tenderDetail, es.tendersPage.triage), "The opening moved from 24 nov 2026, 11:00 to 1 dic 2026, 11:00");
});

test("a detail missing a date renders without throwing", () => {
  assert.doesNotThrow(() => eventText({ ...event, detail: {} }, es.tenderDetail, es.tendersPage.triage));
});
