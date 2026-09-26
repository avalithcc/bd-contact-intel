/**
 * Unit tests for src/lib/contacts/outreachViewParams.ts — parses/serializes
 * the `/contacts?view=outreach` filter query params (task 15a-2; owner
 * decision 2026-09-26: same filter set as `/outreach`). Pure — no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOutreachRedirectQuery,
  buildOutreachViewParams,
  isCompanyCategoryKey,
  isRoleGroupKey,
  parseOutreachViewFilters,
} from "@/lib/contacts/outreachViewParams";

test("isRoleGroupKey/isCompanyCategoryKey accept only known keys", () => {
  assert.equal(isRoleGroupKey("eng_leadership"), true);
  assert.equal(isRoleGroupKey("bogus"), false);
  assert.equal(isRoleGroupKey(undefined), false);
  assert.equal(isCompanyCategoryKey("product_saas"), true);
  assert.equal(isCompanyCategoryKey("bogus"), false);
});

test("parseOutreachViewFilters drops invalid roleGroup/companyCategory/market", () => {
  const filters = parseOutreachViewFilters({
    roleGroup: "bogus",
    companyCategory: "bogus",
    market: "bogus",
  });
  assert.deepEqual(filters, { includeNeverMessaged: true, hideOffshore: false, startupsOnly: false });
});

test("parseOutreachViewFilters only honors miamiOnly when market is 'us'", () => {
  const withUs = parseOutreachViewFilters({ market: "us", miamiOnly: "on" });
  assert.equal(withUs.miamiOnly, true);
  // market !== "us" -> miamiOnly is meaningless and stays absent (not just
  // false), same as /outreach/page.tsx never rendering the control at all.
  const withLatam = parseOutreachViewFilters({ market: "latam", miamiOnly: "on" });
  assert.equal(withLatam.miamiOnly, undefined);
});

test("parseOutreachViewFilters: excludeNever inverts to includeNeverMessaged", () => {
  assert.equal(parseOutreachViewFilters({}).includeNeverMessaged, true);
  assert.equal(parseOutreachViewFilters({ excludeNever: "on" }).includeNeverMessaged, false);
});

test("parseOutreachViewFilters: hideOffshore/startupsOnly are opt-in, off by default", () => {
  assert.equal(parseOutreachViewFilters({}).hideOffshore, false);
  assert.equal(parseOutreachViewFilters({}).startupsOnly, false);
  assert.equal(parseOutreachViewFilters({ hideOffshore: "on" }).hideOffshore, true);
  assert.equal(parseOutreachViewFilters({ startupsOnly: "on" }).startupsOnly, true);
});

test("parseOutreachViewFilters: name is trimmed, blank becomes absent", () => {
  assert.equal(parseOutreachViewFilters({ name: "  Ada  " }).name, "Ada");
  assert.equal(parseOutreachViewFilters({ name: "   " }).name, undefined);
  assert.equal(parseOutreachViewFilters({}).name, undefined);
});

test("buildOutreachViewParams always sets view=outreach and page, carries valid filters only", () => {
  const params = buildOutreachViewParams(
    { roleGroup: "eng_leadership", market: "us", miamiOnly: "on", name: "  Ada  " },
    2,
  );
  assert.equal(params.get("view"), "outreach");
  assert.equal(params.get("page"), "2");
  assert.equal(params.get("roleGroup"), "eng_leadership");
  assert.equal(params.get("market"), "us");
  assert.equal(params.get("miamiOnly"), "on");
  assert.equal(params.get("name"), "Ada");
});

test("buildOutreachViewParams drops miamiOnly when market isn't 'us', and invalid keys", () => {
  const params = buildOutreachViewParams({ roleGroup: "bogus", market: "latam", miamiOnly: "on" }, 1);
  assert.equal(params.has("roleGroup"), false);
  assert.equal(params.has("miamiOnly"), false);
});

test("buildOutreachRedirectQuery maps /outreach's own searchParams 1:1, defaulting page to 1", () => {
  const q = buildOutreachRedirectQuery({
    roleGroup: "eng_leadership",
    market: "us",
    miamiOnly: "on",
    excludeNever: "on",
    hideOffshore: "on",
    startupsOnly: "on",
    name: "Ada",
    page: "3",
  });
  const params = new URLSearchParams(q);
  assert.equal(params.get("view"), "outreach");
  assert.equal(params.get("page"), "3");
  assert.equal(params.get("roleGroup"), "eng_leadership");
  assert.equal(params.get("market"), "us");
  assert.equal(params.get("miamiOnly"), "on");
  assert.equal(params.get("excludeNever"), "on");
  assert.equal(params.get("hideOffshore"), "on");
  assert.equal(params.get("startupsOnly"), "on");
  assert.equal(params.get("name"), "Ada");
});

test("buildOutreachRedirectQuery defaults page to 1 for a missing/invalid page param", () => {
  assert.equal(new URLSearchParams(buildOutreachRedirectQuery({})).get("page"), "1");
  assert.equal(new URLSearchParams(buildOutreachRedirectQuery({ page: "bogus" })).get("page"), "1");
  assert.equal(new URLSearchParams(buildOutreachRedirectQuery({ page: "0" })).get("page"), "1");
});
