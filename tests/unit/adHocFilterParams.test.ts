/**
 * Wiring test: every filter field the toolbar can set must survive the trip
 * search params -> contactFilterParamsFromSearchParams ->
 * applyAdHocContactFilterOverrides. A unit test on the override function
 * alone passed while "Tiene teléfono" was silently dropped by the page.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendAdHocFilterParams,
  CHECKBOX_FILTER_PARAM_KEYS,
  contactFilterParamsFromSearchParams,
} from "@/lib/contacts/adHocFilterParams";
import type { FilterChipField } from "@/lib/contacts/filterChips";
import { FIELD_PARAM_NAMES, FILTER_FIELD_KIND } from "@/lib/contacts/filterFieldKinds";
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
  contactType: "BUYER-CHAMPION",
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

// --- Unchecking a checkbox editor must clear a view-inherited value ---------
// An unchecked checkbox submits nothing, and the editor strips its own hidden
// param, so the field is absent from the query. A "<field>__set=1" marker
// travels with every submit of that editor so the absence can mean "cleared".

const CHECKBOX_FIELDS = ["hasPhone", "hiring", "startupsOnly", "emailVerified"] as const;
type CheckboxField = (typeof CHECKBOX_FIELDS)[number];

/** What a native GET submit of the editor sends, as Next hands it to the page. */
function submitEditor(field: CheckboxField, checked: boolean): Record<string, string> {
  const sp: Record<string, string> = { [`${field}__set`]: "1" };
  if (checked) sp[field] = field === "hiring" ? "1" : "on";
  return sp;
}

function filtersAfter(base: Record<string, boolean>, sp: Record<string, string>) {
  return applyAdHocContactFilterOverrides(base, contactFilterParamsFromSearchParams(sp));
}

for (const field of CHECKBOX_FIELDS) {
  test(`"${field}": inherited from a view and unchecked in the editor -> cleared`, () => {
    assert.equal(filtersAfter({ [field]: true }, submitEditor(field, false))[field], undefined);
  });

  test(`"${field}": inherited from a view and still checked -> stays on`, () => {
    assert.equal(filtersAfter({ [field]: true }, submitEditor(field, true))[field], true);
  });

  test(`"${field}": not inherited and checked -> set`, () => {
    assert.equal(filtersAfter({}, submitEditor(field, true))[field], true);
  });

  test(`"${field}": chip removal (explicit empty value) clears a view-inherited value`, () => {
    assert.equal(filtersAfter({ [field]: true }, { [field]: "" })[field], undefined);
  });

  test(`"${field}": absent param and no marker leaves the inherited value alone`, () => {
    assert.equal(filtersAfter({ [field]: true }, {})[field], true);
  });

  test(`"${field}": pagination links keep an explicit clear and drop the marker`, () => {
    const params = appendAdHocFilterParams(submitEditor(field, false), new URLSearchParams());
    assert.equal(params.get(field), "");
    assert.equal(params.has(`${field}__set`), false);
  });
}

test("the clearable checkbox keys are exactly the checkbox-kind filter fields", () => {
  const kinds = (Object.keys(FILTER_FIELD_KIND) as FilterChipField[]).filter((f) => FILTER_FIELD_KIND[f] === "checkbox");
  assert.deepEqual([...CHECKBOX_FILTER_PARAM_KEYS].sort(), kinds.sort());
});

test("a repeated checkbox param is never applied as a value", () => {
  const input = contactFilterParamsFromSearchParams({ hasPhone: ["", "on"] });
  assert.equal(input.hasPhone, undefined);
});
