/**
 * Wiring test: every filter field the toolbar can set must survive the trip
 * search params -> contactFilterParamsFromSearchParams ->
 * applyAdHocContactFilterOverrides. A unit test on the override function
 * alone passed while "Tiene teléfono" was silently dropped by the page.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { appendAdHocFilterParams, contactFilterParamsFromSearchParams } from "@/lib/contacts/adHocFilterParams";
import type { FilterChipField } from "@/lib/contacts/filterChips";
import { FIELD_PARAM_NAMES } from "@/lib/contacts/filterFieldKinds";
import { applyAdHocContactFilterOverrides } from "@/lib/contacts/viewFilters";

const UUID = "8f14e45f-ceea-467e-9a0c-8c6b4c3e3a1a";

/** A value each field's live parser accepts, as the toolbar submits it. */
const SUBMITTED: Record<FilterChipField, string> = {
  owner: "me",
  status: "new",
  emailStatus: "verified",
  hasPhone: "on",
  company: "Acme",
  hiring: "1",
  market: "us",
  roleGroup: "eng_leadership",
  startupsOnly: "on",
  bdConnected: UUID,
  lastActivityDays: "30",
  industryGroup: "SaaS",
  seniority: "Manager",
  emailVerified: "on",
};

for (const field of Object.keys(SUBMITTED) as FilterChipField[]) {
  test(`page forwarding applies the "${field}" filter from its search param`, () => {
    const paramName = FIELD_PARAM_NAMES[field][0];
    const input = contactFilterParamsFromSearchParams({ [paramName]: SUBMITTED[field] });
    const filters = applyAdHocContactFilterOverrides({}, input);
    assert.notEqual(filters[field], undefined, `${field} was dropped between search params and filters`);
  });
}

test("repeated status params are joined into one CSV value", () => {
  assert.equal(contactFilterParamsFromSearchParams({ status: ["new", "contacted"] }).status, "new,contacted");
});

test("an owner plus hasPhone selection keeps both filters", () => {
  const filters = applyAdHocContactFilterOverrides(
    {},
    contactFilterParamsFromSearchParams({ owner: UUID, hasPhone: "on" }),
  );
  assert.deepEqual(filters, { owner: UUID, hasPhone: true });
});

test("pagination links carry every active filter param, including hasPhone", () => {
  const params = appendAdHocFilterParams(
    { owner: UUID, hasPhone: "on", status: ["new", "contacted"] },
    new URLSearchParams(),
  );
  assert.equal(params.get("owner"), UUID);
  assert.equal(params.get("hasPhone"), "on");
  assert.equal(params.get("status"), "new,contacted");
});
