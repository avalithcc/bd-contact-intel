/**
 * Unit tests for src/lib/contacts/filterChips.ts — the `/contacts` toolbar's
 * removable filter chips (mockups/contacts.html `.chip` + "Quitar filtro").
 * Pure mapping only — no DB — page.tsx renders one chip per entry, each
 * with a link that clears exactly that field's query param.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildActiveFilterChips, type FilterChipContext } from "@/lib/contacts/filterChips";
import type { ContactFilters } from "@/lib/contacts/viewFilters";

const ctx: FilterChipContext = {
  ownerLabel: (v) => (v === "me" ? "Yo" : v === "unassigned" ? "Sin asignar" : `BD ${v}`),
  statusLabel: (s) => ({ new: "Nuevo", contacted: "Contactado", replied: "Respondió", meeting: "Reunión", discarded: "Descartado" })[s],
  emailStatusLabel: (s) => ({ verified: "Verificado", probable: "Probable", none: "Sin correo" })[s],
  marketLabel: (m) => ({ latam: "LATAM", us: "EE. UU.", other: "Otro" })[m] ?? m,
  roleGroupLabel: (k) => `Grupo ${k}`,
  bdName: (id) => `BD ${id}`,
};

test("buildActiveFilterChips returns no chips for an empty filter set", () => {
  assert.deepEqual(buildActiveFilterChips({}, ctx), []);
});

test("buildActiveFilterChips: owner chip", () => {
  const chips = buildActiveFilterChips({ owner: "me" }, ctx);
  assert.deepEqual(chips, [{ field: "owner", label: "Responsable", valueText: "Yo" }]);
});

test("buildActiveFilterChips: status chip joins multiple values with a comma (mockup: 'Nuevo, Contactado')", () => {
  const chips = buildActiveFilterChips({ status: ["new", "contacted"] }, ctx);
  assert.deepEqual(chips, [{ field: "status", label: "Estado", valueText: "Nuevo, Contactado" }]);
});

test("buildActiveFilterChips: one chip per active filter, in a stable order matching the 'Agregar filtro' menu", () => {
  const filters: ContactFilters = {
    owner: "me",
    status: ["new"],
    emailStatus: "verified",
    company: "Mercado Libre",
    hiring: true,
    market: "us",
    roleGroup: "eng_leadership",
    startupsOnly: true,
    bdConnected: "bd-1",
    lastActivityDays: 30,
  };
  const chips = buildActiveFilterChips(filters, ctx);
  assert.deepEqual(
    chips.map((c) => c.field),
    ["owner", "status", "emailStatus", "company", "hiring", "market", "roleGroup", "startupsOnly", "bdConnected", "lastActivityDays"],
  );
});

test("buildActiveFilterChips: hiring/startupsOnly render as a fixed label with no value text", () => {
  const chips = buildActiveFilterChips({ hiring: true, startupsOnly: true }, ctx);
  assert.deepEqual(chips, [
    { field: "hiring", label: "Empresa con vacantes abiertas", valueText: null },
    { field: "startupsOnly", label: "Startup", valueText: null },
  ]);
});

test("buildActiveFilterChips: lastActivityDays renders a human 'últimos N días' value", () => {
  const chips = buildActiveFilterChips({ lastActivityDays: 30 }, ctx);
  assert.deepEqual(chips, [{ field: "lastActivityDays", label: "Última actividad", valueText: "últimos 30 días" }]);
});

test("buildActiveFilterChips: bdConnected resolves through bdName", () => {
  const chips = buildActiveFilterChips({ bdConnected: "bd-1" }, ctx);
  assert.deepEqual(chips, [{ field: "bdConnected", label: "BD conectado", valueText: "BD bd-1" }]);
});
