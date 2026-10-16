import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import { bulkBarView } from "@/lib/sequences/bulkBar";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BulkBar } = require("@/app/(app)/sequences/_components/BulkBar") as typeof import("@/app/(app)/sequences/_components/BulkBar");

const rows = (...reviewed: boolean[]) => reviewed.map((r, i) => ({ id: `m${i + 1}`, reviewed: r }));
const render = (selection: ReturnType<typeof rows>) => renderToStaticMarkup(createElement(BulkBar, { selection, labels: es.sequences, onAction: () => {} }));

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
  assert.match(html, /<button[^>]*class="btn btn-primary btn-sm"[^>]*disabled=""[^>]*>Aprobar y programar los 3</);
  assert.ok(html.includes("Acciones masivas, revisión incompleta") && html.includes("hasta que los 3 hayan sido abiertos"));
});

test("the bar renders the complete state with the approve button enabled and no blocked help", () => {
  const html = render(rows(true, true, true));
  assert.ok(html.includes("3 de 3 borradores ya revisados") && html.includes("Acciones masivas, todos revisados"));
  assert.doesNotMatch(html, /disabled/);
  assert.ok(!html.includes("hasta que"));
});

test("an empty selection renders nothing", () => {
  assert.equal(render([]), "");
});
