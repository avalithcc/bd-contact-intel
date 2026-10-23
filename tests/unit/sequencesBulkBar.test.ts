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
const render = (selection: ReturnType<typeof rows>) => renderToStaticMarkup(createElement(BulkBar, { selection, labels: es.sequences, onAction: () => {}, send: SEND, recipients: [], cap: { cap: 5, sentToday: 0 }, now: new Date("2026-10-15T14:00:00Z"), lock: IDLE_LOCK }));

test("view model: 1 of 3 reviewed disables approve, 3 of 3 enables it", () => {
  assert.deepEqual(bulkBarView(rows(true, false, false)), { visible: true, selected: 3, reviewed: 1, approveEnabled: false, allReviewed: false, ids: ["m1", "m2", "m3"] });
  assert.deepEqual(bulkBarView(rows(true, true, true)), { visible: true, selected: 3, reviewed: 3, approveEnabled: true, allReviewed: true, ids: ["m1", "m2", "m3"] });
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
