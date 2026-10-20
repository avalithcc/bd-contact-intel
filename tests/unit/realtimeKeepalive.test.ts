import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GET } from "@/app/api/realtime/keepalive/route";

const original = process.env.CRON_SECRET;
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

const call = (auth?: string) =>
  GET(new Request("http://localhost/api/realtime/keepalive", { headers: auth ? { authorization: auth } : {} }));

test("keepalive denies a request with no bearer", async () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal((await call()).status, 401);
});

test("keepalive denies a wrong bearer", async () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal((await call("Bearer nope")).status, 401);
});

test("keepalive denies everything when CRON_SECRET is unset, even 'Bearer undefined'", async () => {
  delete process.env.CRON_SECRET;
  assert.equal((await call("Bearer undefined")).status, 401);
  assert.equal((await call("Bearer ")).status, 401);
});
