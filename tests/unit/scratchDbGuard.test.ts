import { test } from "node:test";
import assert from "node:assert/strict";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

test("accepts a localhost database whose name ends in _e2e", () => {
  assert.doesNotThrow(() => assertScratchDatabaseUrl("postgres://localhost:5432/bd_contact_intel_e2e"));
  assert.doesNotThrow(() => assertScratchDatabaseUrl("postgres://me:pw@127.0.0.1:5432/anything_e2e"));
});

test("refuses a remote host even when the database name looks like a scratch one", () => {
  assert.throws(() => assertScratchDatabaseUrl("postgres://u:p@db.abc.supabase.co:5432/postgres_e2e"), /not a local/i);
});

test("refuses a local host with a non-scratch database name", () => {
  assert.throws(() => assertScratchDatabaseUrl("postgres://localhost:5432/postgres"), /_e2e/);
});

test("refuses a missing or unparsable url", () => {
  assert.throws(() => assertScratchDatabaseUrl(undefined), /DATABASE_URL/);
  assert.throws(() => assertScratchDatabaseUrl("not a url"), /DATABASE_URL/);
});

test("refuses a host that merely starts with localhost", () => {
  assert.throws(() => assertScratchDatabaseUrl("postgres://localhost.evil.com:5432/x_e2e"), /not a local/i);
});
