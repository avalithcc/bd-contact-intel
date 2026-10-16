import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import type { SequenceListRow } from "@/lib/sequences/listView";
import { scopeView } from "@/lib/sequences/listScope";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SequenceListView } = require("@/app/(app)/sequences/_components/SequenceListView") as typeof import("@/app/(app)/sequences/_components/SequenceListView");

const NOW = new Date("2026-10-15T16:00:00Z");
const l = es.sequences;
const ME = "11111111-1111-4111-8111-111111111111";
const TR = "22222222-2222-4222-8222-222222222222";
const mk = (id: string, ownerId: string, ownerName: string): SequenceListRow => ({
  id, name: `Seq ${id}`, createdAt: new Date("2026-10-12T15:00:00Z"), dailySendCap: 5, schedule: DEFAULT_SCHEDULE, companies: ["Acme"],
  members: [{ state: "drafted", hasDraft: true, scheduledFor: null }, { state: "replied", hasDraft: true, scheduledFor: null }], owner: { id: ownerId, name: ownerName },
});
const all = [mk("a", ME, "Lucía Ferrer"), mk("b", TR, "Tomás Rivas"), mk("c", TR, "Tomás Rivas")];
const render = (req: Parameters<typeof scopeView>[2], rows = all) => {
  const v = scopeView(rows, ME, req);
  return renderToStaticMarkup(createElement(SequenceListView, { rows: v.rows, labels: l, now: NOW, admin: { scope: req.scope, meId: ME, tabs: v.tabs, owners: v.owners, chipOwner: v.chipOwner } }));
};

test("a BD's list has no tabs, no Responsable column and no admin intro", () => {
  const html = renderToStaticMarkup(createElement(SequenceListView, { rows: [{ ...all[0], owner: undefined }], labels: l, now: NOW }));
  for (const t of [l.listTabMine, l.listColOwner, l.listAdminIntroStrong, "view-tabs"]) assert.ok(!html.includes(t), t);
});

test("Mías (admin): tabs with counts, Responsable column with (yo), all four cards, no owner chip", () => {
  const html = render({ scope: "mine", ownerId: null });
  assert.match(html, /aria-current="page"[^>]*>Mías<span class="count">1<\/span>/);
  assert.ok(html.includes(`>Todas<span class="count">3</span>`));
  assert.ok(html.includes(`<th>${l.listColOwner}</th>`) && html.includes("(yo)"));
  assert.ok(html.includes(l.statReview) && html.includes(l.statQueued));
  assert.ok(!html.includes(l.listAllNote));
  assert.ok(html.includes("1 secuencia · sólo las tuyas"));
});

test("Todas: Responsable filter chip, other BDs' owner without (yo), the two non-actionable cards are hidden", () => {
  const html = render({ scope: "all", ownerId: null });
  assert.ok(html.includes(l.listAllNote) && html.includes("chip chip-add") && html.includes("Tomás Rivas"));
  assert.ok(!html.includes(l.statReview) && !html.includes(l.statQueued));
  assert.ok(html.includes(l.listStatSequences) && html.includes(l.statReplied));
  assert.ok(html.includes("3 secuencias de 2 BD"));
});

test("Todas narrowed to one BD: removable chip, clear-all, note and footer name the BD", () => {
  const html = render({ scope: "all", ownerId: TR });
  assert.ok(html.includes("Tomás Rivas") && html.includes(`aria-label="${l.listRemoveFilter}"`) && html.includes(l.listClearAll));
  assert.ok(html.includes("Se muestran las secuencias de Tomás Rivas") && html.includes("2 secuencias de Tomás Rivas · se abren en solo lectura"));
  assert.ok(!html.includes("chip chip-add"));
});

test("an admin with no Sequences of their own gets the Mías empty state with a shortcut to Todas", () => {
  const html = render({ scope: "mine", ownerId: null }, all.slice(1));
  assert.ok(html.includes(l.listEmptyMineTitle) && html.includes(l.listSeeAll) && html.includes("/sequences?scope=all"));
});
