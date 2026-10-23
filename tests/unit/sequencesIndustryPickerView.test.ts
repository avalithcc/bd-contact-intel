import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import { INDUSTRY_GROUPS, INDUSTRY_GROUP_KEYS } from "@/lib/sequences/industryGroups";
import { groupState, toggleGroup, toggleValue } from "@/lib/sequences/industrySelection";
import { industryCountsFromRows } from "@/lib/sequences/industryCounts";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RosterPicker } = require("@/app/(app)/sequences/_components/RosterPicker") as typeof import("@/app/(app)/sequences/_components/RosterPicker");

const counts = industryCountsFromRows([{ industry: INDUSTRY_GROUPS.tecnologia[0], n: "1000" }, { industry: INDUSTRY_GROUPS.tecnologia[1], n: "304" }, { industry: INDUSTRY_GROUPS.salud[0], n: "395" }, { industry: null, n: "2169" }]);
const html = (industryCounts?: typeof counts) => renderToStaticMarkup(createElement(RosterPicker, { contacts: [], hasMore: false, loadPage: async () => ({ contacts: [], hasMore: false }), industryCounts, selection: new Map(), onChange: () => {}, labels: es.sequences, statusLabels: es.leadStatuses }));

test("one chip per group with its count, plus 'Sin industria' with the bucket the filters leave out", () => {
  const out = html(counts);
  for (const k of INDUSTRY_GROUP_KEYS) assert.ok(out.includes(es.sequences.pickIndustryGroups[k]), k);
  assert.match(out, /Tecnología <span class="meta">1304<\/span>/);
  assert.match(out, /Salud <span class="meta">395<\/span>/);
  assert.match(out, /Sin industria <span class="meta">2169<\/span>/);
  assert.equal((out.match(/class="chip" aria-pressed="false"/g) ?? []).length, 3 + INDUSTRY_GROUP_KEYS.length + 1, "the three existing chips are still there, all unpressed");
});

test("the exact-value list is collapsed by default and its toggle says how many values it holds", () => {
  const out = html(counts);
  assert.match(out, /aria-expanded="false"[^>]*aria-controls="pick-industry-values"/);
  assert.match(out, /Elegir valores exactos \(91\)/);
  assert.match(out, /id="pick-industry-values" hidden/);
});

test("without counts the picker renders exactly as before: no industry row", () => {
  assert.ok(!html().includes(es.sequences.pickIndustry + "</div>"));
  assert.ok(!html().includes("Sin industria"));
});

const FIN = INDUSTRY_GROUPS.finanzas;
const TECH = INDUSTRY_GROUPS.tecnologia;

test("groupState: off, partial ('mixed', never true), and fully on", () => {
  assert.equal(groupState([], "tecnologia"), false);
  assert.equal(groupState([FIN[0]], "tecnologia"), false, "another group's value does not count");
  assert.equal(groupState([TECH[0]], "tecnologia"), "mixed");
  assert.equal(groupState(TECH.slice(0, -1), "tecnologia"), "mixed");
  assert.equal(groupState([...TECH], "tecnologia"), true);
});

test("toggleGroup: off or partial selects ALL its values, fully on drops them, other groups are untouched, input is not mutated", () => {
  const start = Object.freeze([FIN[0], TECH[0]]);
  const on = toggleGroup(start, "tecnologia");
  assert.deepEqual([...on].sort(), [FIN[0], ...TECH].sort(), "partial -> all of tecnologia, finanzas kept");
  assert.equal(groupState(on, "tecnologia"), true);
  assert.deepEqual(toggleGroup(on, "tecnologia"), [FIN[0]], "fully on -> its values go, finanzas stays");
  assert.deepEqual([...toggleGroup([], "logistica")].sort(), [...INDUSTRY_GROUPS.logistica].sort());
  assert.deepEqual(toggleGroup(on, "tecnologia"), toggleGroup(on, "tecnologia"), "same input, same answer");
  assert.deepEqual([...start], [FIN[0], TECH[0]]);
});

test("toggleValue: unticking one value of a full group makes the chip partial", () => {
  const full = toggleGroup([], "tecnologia");
  const one = toggleValue(full, TECH[3]);
  assert.equal(one.length, TECH.length - 1);
  assert.equal(groupState(one, "tecnologia"), "mixed");
  assert.deepEqual(toggleValue(one, TECH[3]).sort(), [...TECH].sort());
});

test("a partial chip is rendered aria-pressed=mixed by the picker contract (state feeds aria-pressed unchanged)", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(process.cwd(), "src/app/(app)/sequences/_components/RosterPicker.tsx"), "utf8") as string;
  assert.match(src, /aria-pressed=\{state\(g\)\}/);
});
