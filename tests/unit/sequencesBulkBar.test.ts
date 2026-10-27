import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import { bulkBarView } from "@/lib/sequences/bulkBar";
import { IDLE_LOCK, SEND } from "./sendContextFixture";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BulkBar } = require("@/app/(app)/sequences/_components/BulkBar") as typeof import("@/app/(app)/sequences/_components/BulkBar");

const rows = (...reviewed: boolean[]) => reviewed.map((r, i) => ({ id: `m${i + 1}`, reviewed: r }));
const render = (selection: readonly { id: string; reviewed: boolean; wrongLanguage?: boolean }[], mismatched: Record<string, string> = {}) => renderToStaticMarkup(createElement(BulkBar, { selection, labels: es.sequences, onAction: () => {}, send: SEND, recipients: [], cap: { cap: 5, sentToday: 0 }, now: new Date("2026-10-15T14:00:00Z"), lock: IDLE_LOCK, mismatched }));

test("view model: 1 of 3 reviewed disables approve, 3 of 3 enables it", () => {
  assert.deepEqual(bulkBarView(rows(true, false, false)), { visible: true, selected: 3, reviewed: 1, approveEnabled: false, allReviewed: false, ids: ["m1", "m2", "m3"], wrongLanguage: 0 });
  assert.deepEqual(bulkBarView(rows(true, true, true)), { visible: true, selected: 3, reviewed: 3, approveEnabled: true, allReviewed: true, ids: ["m1", "m2", "m3"], wrongLanguage: 0 });
});

test("view model: a fully reviewed selection plus an unreviewed 4th row is 3 of 4 and disabled", () => {
  const v = bulkBarView(rows(true, true, true, false));
  assert.deepEqual([v.reviewed, v.selected, v.approveEnabled], [3, 4, false]);
});

test("view model: no selection hides the bar, and a duplicated row counts once", () => {
  assert.equal(bulkBarView([]).visible, false);
  assert.deepEqual(bulkBarView([{ id: "a", reviewed: true }, { id: "a", reviewed: true }]).ids, ["a"]);
});

test("the bar renders the partial state as the mockup draws it, with the approve button disabled", () => {
  const html = render(rows(true, false, false));
  assert.ok(html.includes("3 seleccionados") && html.includes("1 de 3 borradores revisados"));
  assert.ok(html.includes("Quitar de la secuencia") && !html.includes("Regenerar"));
  assert.match(html, /<button[^>]*class="btn btn-primary btn-sm"[^>]*disabled=""[^>]*>(?:<svg.*?<\/svg>)?Aprobar y enviar ahora los 3</);
  assert.ok(html.includes("Acciones masivas, revisión incompleta"));
});

/** The substring of `html` that is the .bulk-bar element (the bar has no nested div, so the first </div> closes it). */
const barOf = (html: string) => html.slice(html.indexOf('class="bulk-bar"'), html.indexOf("</div>", html.indexOf('class="bulk-bar"')));

test("the review-gate reason travels inside the sticky bar, not after it", () => {
  const html = render(rows(true, false, false, false));
  const reason = "<strong>Faltan 3 borradores</strong> por abrir. Aprobar a ciegas en bloque es exactamente lo que este bloqueo evita.";
  assert.ok(barOf(html).includes(reason), html);
  assert.equal(html.split(reason).length - 1, 1);
  assert.ok(!html.slice(html.indexOf("</div>")).includes("Faltan"), "nothing left behind outside the bar");
});

test("the disabled button names how many drafts are still unopened on hover", () => {
  assert.match(render(rows(true, false, false, false)), /title="Faltan 3 borradores por abrir"/);
  assert.match(render(rows(true, true, false)), /title="Falta 1 borrador por abrir"/);
});

test("an enabled button has no gate title and no reason", () => {
  const html = render(rows(true, true));
  assert.ok(!html.includes("por abrir") && !html.includes("title="));
});

test("the bar renders the complete state with the approve button enabled and no blocked help", () => {
  const html = render(rows(true, true, true));
  assert.ok(html.includes("3 de 3 borradores ya revisados") && html.includes("Acciones masivas, todos revisados"));
  assert.doesNotMatch(html, /disabled/);
  assert.ok(!html.includes("a ciegas"));
});

test("an empty selection renders nothing", () => {
  assert.equal(render([]), "");
});

test("a selected draft in another language blocks the bulk: the bold reason names it inside the sticky bar, with the gate's own sentence after it", () => {
  const html = render([{ id: "m1", reviewed: true }, { id: "m2", reviewed: true, wrongLanguage: true }], { m2: "Ana Gómez" });
  const note = '<p class="note"><strong>1 de los seleccionados está en otro idioma</strong>: Ana Gómez. Sacalo de la selección o corregilo para aprobar. Aprobar a ciegas en bloque es exactamente lo que este bloqueo evita.</p>';
  assert.ok(barOf(html).includes(note), html);
  assert.match(html, /title="1 de los seleccionados está en otro idioma: Ana Gómez\. Sacalo de la selección o corregilo para aprobar\."/, "the title is the plain sentence");
  assert.match(html, /aria-label="Acciones masivas, hay borradores en otro idioma"/);
  assert.match(html, /<button[^>]*class="btn btn-primary btn-sm"[^>]*disabled=""/);
  assert.ok(!html.includes("por abrir"), "every draft was opened: the review reason must not appear");
  assert.ok(!html.includes("Quedó afuera"), "a selected mismatched draft is blocked, not left out");
});

test("the review gate is untouched when a language block joins it: both reasons show, and the review reason is not replaced", () => {
  const html = render([{ id: "m1", reviewed: false }, { id: "m2", reviewed: true, wrongLanguage: true }, { id: "m3", reviewed: true, wrongLanguage: true }], { m2: "Ana", m3: "Beto" });
  assert.ok(barOf(html).includes("<strong>Falta 1 borrador</strong> por abrir."));
  assert.ok(barOf(html).includes("<strong>2 de los seleccionados están en otro idioma</strong>: Ana, Beto."));
  assert.equal(barOf(html).split(es.sequences.bulkBlockedWhy).length - 1, 1, "the gate sentence is said once when both reasons show");
});

test("drafts left out of the selection are named in the bar with the bold count, and the rest are counted", () => {
  assert.ok(barOf(render(rows(true), { x: "Ana Gómez" })).includes('<p class="note">Quedó afuera <strong>1 borrador en otro idioma</strong>: Ana Gómez. Regeneralo o mantenelo en su idioma para incluirlo.</p>'));
  assert.ok(barOf(render(rows(true), { a: "A", b: "B", c: "C", d: "D", e: "E" })).includes("Quedaron afuera <strong>5 borradores en otro idioma</strong>: A, B, C, +2 más."));
  assert.ok(!render(rows(true)).includes("afuera"));
});
