/**
 * Unit tests for src/lib/companies/listParams.ts — the one parser that turns
 * the `/companies` query string into validated filters, shared by the page
 * and the bulk action so "select all matching" acts on exactly what the list
 * shows.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCompanyListParams } from "@/lib/companies/listParams";

test("parseCompanyListParams: valid values pass through, q is trimmed", () => {
  const f = parseCompanyListParams(
    new URLSearchParams("view=mine&stage=won&industry=Fintech&owner=abc&accountType=client&clientStatus=none&linkedin=with&q=%20acme%20"),
  );
  assert.deepEqual(f, {
    view: "mine",
    stage: "won",
    industry: "Fintech",
    owner: "abc",
    accountType: "client",
    clientStatus: "none",
    linkedin: "with",
    q: "acme",
  });
});

test("parseCompanyListParams: invalid values are ignored, view defaults to all", () => {
  const f = parseCompanyListParams(new URLSearchParams("view=zzz&stage=zzz&accountType=x&clientStatus=x&linkedin=x&q=%20"));
  assert.deepEqual(f, {
    view: "all",
    stage: undefined,
    industry: undefined,
    owner: undefined,
    accountType: undefined,
    clientStatus: undefined,
    linkedin: undefined,
    q: undefined,
  });
});
