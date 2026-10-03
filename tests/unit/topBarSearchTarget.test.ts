/**
 * Unit tests for src/lib/shell/topBarSearchTarget.ts (owner report
 * 2026-09-30: header search always submits to `/contacts`, even from
 * `/companies`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTopBarSearchTarget, topBarSearchBasePath } from "@/lib/shell/topBarSearchTarget";

test("resolveTopBarSearchTarget: /companies resolves to companies", () => {
  assert.equal(resolveTopBarSearchTarget("/companies"), "companies");
});

test("resolveTopBarSearchTarget: /companies/[key] (record page) resolves to companies", () => {
  assert.equal(resolveTopBarSearchTarget("/companies/acme-corp"), "companies");
});

test("resolveTopBarSearchTarget: /contacts resolves to contacts", () => {
  assert.equal(resolveTopBarSearchTarget("/contacts"), "contacts");
});

// Superseded 2026-10-03: every other route used to fall back to "contacts",
// which is exactly what the owner reported — a contacts search box on /admin,
// whose submit navigated him out of the section. These now resolve to null.
test("resolveTopBarSearchTarget: every other route has no search", () => {
  assert.equal(resolveTopBarSearchTarget("/"), null);
  assert.equal(resolveTopBarSearchTarget("/hiring"), null);
  assert.equal(resolveTopBarSearchTarget("/tasks"), null);
});

test("resolveTopBarSearchTarget: a path that merely contains 'companies' later (not a prefix) stays contacts", () => {
  assert.equal(resolveTopBarSearchTarget("/contacts/companies-view"), "contacts");
});

test("topBarSearchBasePath: maps each target to its own route", () => {
  assert.equal(topBarSearchBasePath("companies"), "/companies");
  assert.equal(topBarSearchBasePath("contacts"), "/contacts");
});

test("no search outside the contacts and companies sections", () => {
  // Owner report 2026-10-03: the box appeared on every route and searched
  // contacts by default, so submitting it from /admin threw the user out of
  // the section they were in. These must resolve to null, not "contacts".
  for (const p of [
    "/",
    "/admin",
    "/admin/duplicates",
    "/tasks",
    "/follow-ups",
    "/playbook",
    "/hiring",
    "/discovery",
    "/leads",
    "/outreach",
    "/account",
    "/account/linkedin-messages",
    "/whats-new",
    "/contact-status",
  ]) {
    assert.equal(resolveTopBarSearchTarget(p), null, `expected no search on ${p}`);
  }
});

test("keeps the search inside both sections, record pages included", () => {
  assert.equal(resolveTopBarSearchTarget("/contacts"), "contacts");
  assert.equal(resolveTopBarSearchTarget("/contacts/abc-123"), "contacts");
  assert.equal(resolveTopBarSearchTarget("/contacts/import"), "contacts");
  // Legacy singular redirect: keep it on the contacts side so the box does
  // not blink out during the hop to /contacts/[id].
  assert.equal(resolveTopBarSearchTarget("/contact/abc-123"), "contacts");
  assert.equal(resolveTopBarSearchTarget("/companies"), "companies");
  assert.equal(resolveTopBarSearchTarget("/companies/acme"), "companies");
});
