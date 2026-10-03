import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isWriteRequest,
  writesAllowed,
  writeSkipReason,
  describeViolations,
  serverPlan,
} from "../e2e/readOnlyGuard";

const APP = "http://localhost:3000";
const req = (method: string, path: string) => ({ method, url: `${APP}${path}` });

test("GET, HEAD and OPTIONS pages and RSC fetches are not writes", () => {
  for (const m of ["GET", "HEAD", "OPTIONS", "get"]) {
    assert.equal(isWriteRequest(req(m, "/contacts?columns=phone"), APP), false, m);
  }
});

test("a POST to a page is a write (that is how a server action arrives)", () => {
  assert.equal(isWriteRequest(req("POST", "/contacts"), APP), true);
  assert.equal(isWriteRequest(req("post", "/companies/abc"), APP), true);
});

test("PUT, PATCH and DELETE are writes", () => {
  for (const m of ["PUT", "PATCH", "DELETE"]) assert.equal(isWriteRequest(req(m, "/x"), APP), true, m);
});

test("a GET route handler under /api is treated as a write (cron, ingest, oauth start)", () => {
  assert.equal(isWriteRequest(req("GET", "/api/gmail/sync"), APP), true);
  assert.equal(isWriteRequest(req("GET", "/api/gmail/oauth/start"), APP), true);
  assert.equal(isWriteRequest(req("GET", "/auth/confirm?token_hash=x"), APP), true);
});

test("the read-only CSV export is not a write", () => {
  assert.equal(isWriteRequest(req("GET", "/contacts/export?view=all"), APP), false);
});

test("requests to other origins are not the app's writes (Supabase auth, fonts)", () => {
  assert.equal(isWriteRequest({ method: "POST", url: "https://abc.supabase.co/auth/v1/token" }, APP), false);
});

test("Next.js dev-server internals are ignored", () => {
  assert.equal(isWriteRequest(req("POST", "/__nextjs_original-stack-frames"), APP), false);
  assert.equal(isWriteRequest(req("POST", "/_next/static/x"), APP), false);
});

test("a lookalike host is another origin, an unparsable url is not a write", () => {
  assert.equal(isWriteRequest({ method: "POST", url: "http://localhost:3000.evil.com/x" }, APP), false);
  assert.equal(isWriteRequest({ method: "POST", url: "not a url" }, APP), false);
});

test("writes are allowed only against a scratch database, and fail closed otherwise", () => {
  assert.equal(writesAllowed("postgres://localhost:5432/bd_contact_intel_e2e"), true);
  assert.equal(writesAllowed("postgres://u:p@db.abc.supabase.co:5432/postgres"), false);
  assert.equal(writesAllowed("postgres://localhost:5432/postgres"), false);
  assert.equal(writesAllowed(undefined), false);
  assert.equal(writesAllowed("garbage"), false);
});

test("writeSkipReason is null on scratch and names the contract otherwise", () => {
  assert.equal(writeSkipReason("postgres://localhost/x_e2e"), null);
  assert.match(writeSkipReason("postgres://db.x.supabase.co/postgres") ?? "", /scratch/i);
  assert.match(writeSkipReason(undefined) ?? "", /scratch/i);
});

test("describeViolations lists each blocked request", () => {
  const msg = describeViolations([
    { method: "POST", url: `${APP}/contacts` },
    { method: "GET", url: `${APP}/api/gmail/sync` },
  ]);
  assert.match(msg, /POST http:\/\/localhost:3000\/contacts/);
  assert.match(msg, /GET http:\/\/localhost:3000\/api\/gmail\/sync/);
  assert.match(msg, /read-only/i);
});

test("server plan: read-only mode may reuse the dev server on :3000", () => {
  const plan = serverPlan("postgres://u:p@db.abc.supabase.co:5432/postgres", false);
  assert.equal(plan.port, 3000);
  assert.equal(plan.reuseExistingServer, true);
  assert.equal(plan.env, undefined);
  assert.equal(serverPlan(undefined, true).reuseExistingServer, false);
});

test("server plan: writes allowed means a dedicated port, never reused, with an explicit DATABASE_URL", () => {
  const url = "postgres://localhost:5432/bd_contact_intel_e2e";
  for (const ci of [false, true]) {
    const plan = serverPlan(url, ci);
    assert.notEqual(plan.port, 3000);
    assert.equal(plan.reuseExistingServer, false);
    assert.deepEqual(plan.env, { DATABASE_URL: url });
  }
});
