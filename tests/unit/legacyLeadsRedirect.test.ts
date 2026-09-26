/**
 * Unit tests for src/lib/contacts/legacyLeadsRedirect.ts (task 13.3: `/leads`
 * redirect to `/contacts?view=...`, now that the parity inventory shows every
 * feature has an equivalent). Pure query-string mapper — no DB, no
 * `redirect()` — the page (page.tsx) is a thin wrapper over this.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContactsRedirectQuery } from "@/lib/contacts/legacyLeadsRedirect";

test("buildContactsRedirectQuery with no params redirects to the default 'all' view", () => {
  assert.equal(buildContactsRedirectQuery({}), "view=all");
});

test("maps name and company into the combined q search", () => {
  assert.equal(buildContactsRedirectQuery({ name: "Ana" }), "view=all&q=Ana");
  assert.equal(buildContactsRedirectQuery({ company: "Acme" }), "view=all&q=Acme");
  assert.equal(
    buildContactsRedirectQuery({ name: "Ana", company: "Acme" }),
    "view=all&q=Ana+Acme",
  );
});

test("maps industryGroup, seniority, emailStatus, status straight through (same vocabulary)", () => {
  assert.equal(
    buildContactsRedirectQuery({ industryGroup: "SaaS" }),
    "view=all&industryGroup=SaaS",
  );
  assert.equal(buildContactsRedirectQuery({ seniority: "Manager" }), "view=all&seniority=Manager");
  assert.equal(buildContactsRedirectQuery({ emailStatus: "probable" }), "view=all&emailStatus=probable");
  assert.equal(buildContactsRedirectQuery({ status: "meeting" }), "view=all&status=meeting");
});

test("maps owner: 'mine' -> 'me', 'unassigned' stays, a bd uuid passes through", () => {
  assert.equal(buildContactsRedirectQuery({ owner: "mine" }), "view=all&owner=me");
  assert.equal(buildContactsRedirectQuery({ owner: "unassigned" }), "view=all&owner=unassigned");
  const uuid = "11111111-1111-4111-8111-111111111111";
  assert.equal(buildContactsRedirectQuery({ owner: uuid }), `view=all&owner=${uuid}`);
});

test("maps view=board to layout=board, and page through", () => {
  assert.equal(buildContactsRedirectQuery({ view: "board" }), "view=all&layout=board");
  assert.equal(buildContactsRedirectQuery({ page: "3" }), "view=all&page=3");
});

test("drops unrecognized/invalid values instead of forwarding them", () => {
  assert.equal(buildContactsRedirectQuery({ emailStatus: "bogus" }), "view=all");
  assert.equal(buildContactsRedirectQuery({ status: "bogus" }), "view=all");
});

test("combines every mapped field in one query string", () => {
  const result = buildContactsRedirectQuery({
    name: "Ana",
    industryGroup: "SaaS",
    owner: "mine",
    emailStatus: "verified",
    status: "new",
    view: "board",
    page: "2",
  });
  assert.equal(
    result,
    "view=all&q=Ana&industryGroup=SaaS&owner=me&emailStatus=verified&status=new&layout=board&page=2",
  );
});
