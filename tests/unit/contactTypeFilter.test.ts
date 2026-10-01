/**
 * The "Tipo de contacto" list filter: SQL condition plus the
 * search-param -> filters -> chip chain. Pure modules only (no live DB).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { contactTypeFilterCondition } from "@/lib/contacts/contactTypeCondition";
import { buildActiveFilterChips, FILTER_FIELD_LABEL, type FilterChipContext } from "@/lib/contacts/filterChips";
import { EXTRA_FILTER_MENU_ORDER, FILTER_FIELD_KIND, FILTER_MENU_ORDER } from "@/lib/contacts/filterFieldKinds";
import { contactFilterParamsFromSearchParams } from "@/lib/contacts/adHocFilterParams";
import {
  applyAdHocContactFilterOverrides,
  parseContactFilters,
  sanitizeContactFilters,
  serializeContactFilters,
} from "@/lib/contacts/viewFilters";

const dialect = new PgDialect();

for (const value of ["BUYER-CHAMPION", "INFLUENCER"] as const) {
  test(`SQL condition for ${value} is an equality on contact_type`, () => {
    const { sql, params } = dialect.sqlToQuery(contactTypeFilterCondition(value));
    assert.match(sql, /"person"\."contact_type" = \$1/);
    assert.deepEqual(params, [value]);
  });
}

test("SQL condition never matches NULL rows (no 'is null' / OR branch)", () => {
  const { sql } = dialect.sqlToQuery(contactTypeFilterCondition("INFLUENCER"));
  assert.doesNotMatch(sql, /is null|\bor\b/i);
});

test("filter serializes, parses and sanitizes as a closed set", () => {
  const params = serializeContactFilters({ contactType: "BUYER-CHAMPION" });
  assert.equal(params.get("contactType"), "BUYER-CHAMPION");
  assert.deepEqual(parseContactFilters(params), { contactType: "BUYER-CHAMPION" });
  assert.deepEqual(sanitizeContactFilters({ contactType: "INFLUENCER" }), { contactType: "INFLUENCER" });
  assert.deepEqual(sanitizeContactFilters({ contactType: "DECISION-MAKER" }), {});
  assert.deepEqual(parseContactFilters(new URLSearchParams("contactType=none")), {});
});

test("ad-hoc override sets, clears, and ignores an invalid value (no 'Sin tipo' option exists)", () => {
  assert.deepEqual(applyAdHocContactFilterOverrides({}, { contactType: "INFLUENCER" }), { contactType: "INFLUENCER" });
  assert.deepEqual(applyAdHocContactFilterOverrides({ contactType: "INFLUENCER" }, { contactType: "" }), {});
  assert.deepEqual(applyAdHocContactFilterOverrides({}, { contactType: "none" }), {});
  assert.deepEqual(applyAdHocContactFilterOverrides({ contactType: "INFLUENCER" }, { contactType: "none" }), {
    contactType: "INFLUENCER",
  });
});

test("search param survives to the filters", () => {
  const input = contactFilterParamsFromSearchParams({ contactType: "BUYER-CHAMPION" });
  assert.deepEqual(applyAdHocContactFilterOverrides({}, input), { contactType: "BUYER-CHAMPION" });
});

const ctx: FilterChipContext = {
  ownerLabel: (v) => v,
  statusLabel: (s) => s,
  emailStatusLabel: (s) => s,
  marketLabel: (m) => m,
  roleGroupLabel: (k) => k,
  bdName: (id) => id,
};

test("chip shows the Spanish label and sits right after the role-group chip", () => {
  const chips = buildActiveFilterChips({ contactType: "BUYER-CHAMPION", roleGroup: "x", startupsOnly: true }, ctx);
  assert.deepEqual(
    chips.map((c) => c.field),
    ["roleGroup", "contactType", "startupsOnly"],
  );
  const chip = chips.find((c) => c.field === "contactType");
  assert.deepEqual(chip, { field: "contactType", label: "Tipo de contacto", valueText: "Comprador / promotor" });
  assert.equal(FILTER_FIELD_LABEL.contactType, "Tipo de contacto");
});

test("menu: main group, right after 'Grupo de rol', as a select", () => {
  const i = FILTER_MENU_ORDER.indexOf("roleGroup");
  assert.equal(FILTER_MENU_ORDER[i + 1], "contactType");
  assert.equal(FILTER_FIELD_KIND.contactType, "select");
  assert.equal(EXTRA_FILTER_MENU_ORDER.includes("contactType"), false);
});
