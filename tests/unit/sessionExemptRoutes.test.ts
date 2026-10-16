import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SESSION_EXEMPT_ROUTES, isSessionExemptPath } from "@/lib/auth/sessionExemptRoutes";

test("the two sequence routes are session-exempt, alongside every route that was already", () => {
  for (const route of ["/api/unsubscribe", "/api/sequences/run", "/api/hiring/sync", "/api/hiring/discover", "/api/leads/ingest", "/api/tasks/digest", "/api/gmail/sync", "/api/gmail/reminders", "/api/owners/recompute"]) {
    assert.ok(SESSION_EXEMPT_ROUTES.includes(route), route);
    assert.ok(isSessionExemptPath(route), route);
  }
});

test("exact match or slash prefix: a sibling that merely starts with the same text is NOT exempt", () => {
  assert.equal(isSessionExemptPath("/api/unsubscribe/anything"), true);
  assert.equal(isSessionExemptPath("/api/unsubscribe-admin"), false);
  assert.equal(isSessionExemptPath("/api/sequences/run-now"), false);
  assert.equal(isSessionExemptPath("/api/sequences"), false);
  assert.equal(isSessionExemptPath("/api/sequences/other"), false);
  assert.equal(isSessionExemptPath("/api/hiring-admin"), false);
});

test("the session pages are not exempt: only the two API routes are", () => {
  for (const path of ["/sequences", "/sequences/new", "/sequences/abc"]) assert.equal(isSessionExemptPath(path), false, path);
});

test("the middleware consumes the shared list under its new name, not a local CRON_ROUTES", () => {
  const source = readFileSync(join(__dirname, "..", "..", "src", "lib", "supabase", "middleware.ts"), "utf8");
  assert.match(source, /isSessionExemptPath/);
  assert.doesNotMatch(source, /CRON_ROUTES/);
});
