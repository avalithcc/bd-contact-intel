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

test("resolveTopBarSearchTarget: every other route falls back to contacts (pre-existing behavior)", () => {
  assert.equal(resolveTopBarSearchTarget("/"), "contacts");
  assert.equal(resolveTopBarSearchTarget("/hiring"), "contacts");
  assert.equal(resolveTopBarSearchTarget("/tasks"), "contacts");
});

test("resolveTopBarSearchTarget: a path that merely contains 'companies' later (not a prefix) stays contacts", () => {
  assert.equal(resolveTopBarSearchTarget("/contacts/companies-view"), "contacts");
});

test("topBarSearchBasePath: maps each target to its own route", () => {
  assert.equal(topBarSearchBasePath("companies"), "/companies");
  assert.equal(topBarSearchBasePath("contacts"), "/contacts");
});
