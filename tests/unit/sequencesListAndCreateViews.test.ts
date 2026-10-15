import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import type { BlockKind, PickerContact } from "@/lib/sequences/pickerView";
import type { SequenceListRow } from "@/lib/sequences/listView";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import type { StatMember } from "@/lib/sequences/stats";

(globalThis as { React?: unknown }).React = React;
const C = "@/app/(app)/sequences/_components";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SequenceListView } = require(`${C}/SequenceListView`) as typeof import("@/app/(app)/sequences/_components/SequenceListView");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SequenceCreateForm } = require(`${C}/SequenceCreateForm`) as typeof import("@/app/(app)/sequences/_components/SequenceCreateForm");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RosterPicker } = require(`${C}/RosterPicker`) as typeof import("@/app/(app)/sequences/_components/RosterPicker");

const NOW = new Date("2026-10-15T16:00:00Z");
const l = es.sequences;
const st = es.leadStatuses;
const mem = (state: StatMember["state"], scheduledFor: Date | null = null): StatMember => ({ state, hasDraft: true, scheduledFor });
const seq = (id: string, createdAt: string, members: StatMember[], over: Partial<SequenceListRow> = {}): SequenceListRow =>
  ({ id, name: `Seq ${id}`, createdAt: new Date(createdAt), dailySendCap: 5, schedule: DEFAULT_SCHEDULE, companies: ["Acme", "Bolt", "Core", "Dune"], members, ...over });
const rows = [
  seq("a", "2026-10-12T15:00:00Z", [mem("drafted"), mem("drafted"), mem("approved", new Date("2026-10-16T13:00:00Z")), mem("sent"), mem("replied"), mem("discarded")]),
  seq("b", "2026-10-14T15:00:00Z", [mem("drafted"), mem("approved", new Date("2026-10-16T13:00:00Z"))], { dailySendCap: 10, companies: ["Acme"] }),
];
const list = renderToStaticMarkup(createElement(SequenceListView, { rows, labels: l, now: NOW }));

const person = (id: string, key: string | null, over: Partial<PickerContact> = {}): PickerContact => ({
  personId: id, name: `Person ${id}`, jobTitle: "Lead", status: "new", company: key && `Co ${key}`, companyKey: key, florida: false, openIt: 2,
  email: `${id}@x.example`, emailStatus: "verified", emailSource: null, block: null, blockDetail: null, survivorId: null, ...over,
});
const pool = [
  person("a", "k1", { florida: true }), person("b", "k1"), person("c", "k1"), person("d", "k2", { emailStatus: "probable" }),
  person("m", "k3", { block: "merged", survivorId: "live-id" }), person("s", "k4", { block: "client" }),
];
const picker = (selection: PickerContact[], list: PickerContact[] = pool) =>
  renderToStaticMarkup(createElement(RosterPicker, { contacts: list, selection: new Map(selection.map((c) => [c.personId, c])), onChange: () => {}, labels: l, statusLabels: st }));
const form = renderToStaticMarkup(createElement(SequenceCreateForm, { contacts: pool, account: { address: "bd@avalith.example" }, labels: l, statusLabels: st, onSubmit: () => {} }));

test("the company-limit reason joins names through the locale, never a hardcoded conjunction", () => {
  const chosen = [pool[0], pool[1]];
  const sel = new Map(chosen.map((c) => [c.personId, c]));
  const render = (labels: typeof es.sequences) =>
    renderToStaticMarkup(createElement(RosterPicker, { contacts: pool, selection: sel, onChange: () => {}, labels, statusLabels: st }));
  assert.match(render(es.sequences), /Person a y Person b/, "Spanish joins with 'y'");
  assert.match(render(en.sequences), /Person a and Person b/, "English must not inherit the Spanish conjunction");
});

const at = (html: string, ...needles: string[]) => {
  let from = -1;
  for (const n of needles) {
    const i = html.indexOf(n, from + 1);
    assert.ok(i > from, `"${n}" missing or out of order`);
    from = i;
  }
};

test("list: header, four cards, columns and footer appear in the mockup's order", () => {
  at(list, "Outreach", "Secuencias", "Sólo ves las tuyas", "Nueva secuencia", "stat neutral", "stat info", "stat accent", "stat success", "Estado de los contactos", "Tope diario", "Cadencia", "Creada", "2 secuencias · sólo se muestran las tuyas", "Ordenadas por fecha de creación");
  assert.ok(list.includes('href="/sequences/new"') && list.includes('href="/sequences/a"'));
});

test("list: cards total every sequence and name the next release in Miami time", () => {
  assert.ok(list.includes("8 contactos en total") && list.includes("en 2 secuencias") && list.includes("salen mañana 09:00"));
});

test("list: newest first, state badges only when non-zero, over-8 cap warned, cadence from the sequence's schedule", () => {
  at(list, "Seq b", "Seq a");
  assert.ok(list.includes("2 por revisar") && list.includes("1 en cola") && list.includes("1 enviado") && list.includes("1 respondió") && list.includes("1 quitado"));
  assert.equal((list.match(/Sobre 8/g) ?? []).length, 1);
  assert.ok(list.includes("Acme, Bolt y 2 empresas más") && list.includes("Presentación + recordatorio a los 7 días") && list.includes("12 oct 2026") && list.includes("hace 3 días"));
});

test("list: with no sequences it shows the empty state and no table", () => {
  const empty = renderToStaticMarkup(createElement(SequenceListView, { rows: [], labels: l, now: NOW }));
  assert.ok(empty.includes("Todavía no tenés secuencias") && empty.includes('href="/sequences/new"') && !empty.includes("<table"));
});

test("form: settings first, one cadence option, default cap, no warning, button disabled until a contact is chosen", () => {
  at(form, "Nueva secuencia", "Ajustes", "Nombre de la secuencia", "Cuenta desde la que se envía", "Tope diario de envíos", "Cadencia", "Contactos", "Elegiste", "Máximo 2 contactos por empresa", "Cancelar");
  assert.equal((form.match(/<option/g) ?? []).length, 1);
  assert.ok(form.includes("Predeterminado 5 · máximo 15") && form.includes("bd@avalith.example") && form.includes("Conectada"));
  assert.ok(!form.includes("alert-warn") && !form.includes("subdominio"));
  assert.match(form, /<button[^>]*class="btn btn-primary"[^>]*disabled=""[^>]*>Elegí al menos un contacto para crear</);
  assert.ok(form.includes('<div class="segmented"') && form.includes("Todo EE. UU."));
});

test("form: without a connected account it says so and cannot be submitted", () => {
  const html = renderToStaticMarkup(createElement(SequenceCreateForm, { contacts: pool, account: null, labels: l, statusLabels: st, onSubmit: () => {} }));
  assert.ok(html.includes("Sin conectar") && html.includes("No tenés una cuenta de Gmail conectada"));
});

test("picker: counters come from the selection, even when the list shows none of the chosen contacts", () => {
  const html = picker([pool[0], pool[1], pool[3]], [pool[2]]);
  assert.ok(html.includes("3 elegidos") && html.includes("2 empresas") && html.includes("cupo por empresa: Co k1 2 de 2"));
  // The only row shown is the third Co k1 contact: blocked by the limit the selection set, with both chosen names in the reason.
  assert.ok(html.includes("Límite por empresa") && html.includes("Ya elegiste 2 contactos de Co k1 (Person a y Person b). El máximo es 2 por empresa."));
});

test("picker: rows, badges and reasons as the mockup draws them", () => {
  const html = picker([pool[0]]);
  at(html, "Elegir todos los disponibles", "Contacto", "Empresa", "Correo", "Disponibilidad", "Person a", "Florida", "2 vacantes IT abiertas", "Verificado", "Elegido", "1 de 2 en la empresa", "Person b", "Disponible", "Person d", "Probable", "No se pueden agregar · 2", "Person m", "Fusionado", "Person s", "Cliente");
  assert.ok(html.includes('class="selected"') && html.includes('aria-label="No se puede elegir a Person m"') && html.includes('href="/contacts/live-id"'));
  assert.ok(html.includes("2 disponibles") === false || html.includes("3 disponibles"));
  assert.ok(html.includes("4 disponibles · 2 que no se pueden agregar, con el motivo") && html.includes("Cupo por empresa: 2") && html.includes("Mostrar los que no se pueden agregar"));
});

test("every block reason is worded in both languages", () => {
  const kinds = { client: 1, clientFormer: 1, suppressed: 1, member: 1, merged: 1, noEmail: 1, unreachable: 1, inferred: 1, noPosting: 1, companyLimit: 1 } satisfies Record<BlockKind, 1>;
  for (const d of [es.sequences, en.sequences]) for (const k of Object.keys(kinds)) assert.ok(d.blockLabels[k as BlockKind] && d.blockWhy[k as BlockKind], k);
  assert.deepEqual(Object.keys(es.sequences).sort(), Object.keys(en.sequences).sort());
});

test("every class the list, form and picker render exists in the approved stylesheet", () => {
  const css = readFileSync(join(__dirname, "../../openspec/changes/crm-hubspot-ux/mockups/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const known = new Set<string>();
  for (const p of css.match(/[^{}]+(?=\{)/g) ?? []) for (const m of p.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) known.add(m[1]);
  const used = new Set<string>();
  const statuses = es.leadStatuses;
  const all = [list, form, picker([pool[0]]), renderToStaticMarkup(createElement(RosterPicker, { contacts: Object.keys(statuses).flatMap((s, i) => [person(`s${i}`, `q${i}`, { status: s as PickerContact["status"] }), person(`i${i}`, `r${i}`, { emailStatus: "probable", emailSource: "pattern_inferred" }), person(`n${i}`, `t${i}`, { emailStatus: "none" })]), selection: new Map(), onChange: () => {}, labels: l, statusLabels: st }))];
  for (const html of all) for (const m of html.matchAll(/class="([^"]*)"/g)) for (const t of m[1].split(/\s+/).filter(Boolean)) used.add(t);
  assert.ok(used.size > 40);
  assert.deepEqual([...used].filter((c) => !known.has(c)).sort(), []);
});
