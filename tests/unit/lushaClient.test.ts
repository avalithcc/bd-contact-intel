import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LushaError, isRetryableByBd } from "../../src/lib/lusha/errors";
import { enrichContact, getAccountUsage, searchContact, type FetchFn } from "../../src/lib/lusha/client";

const KEY = "sk-secret-key-value-123";
const fixture = (name: string): string => readFileSync(join(__dirname, "fixtures", "lusha", name), "utf8");

interface Call {
  url: string;
  init: RequestInit;
}
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { fn, calls };
}
const json = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
const person = { personId: "person-aaa", firstName: "Ada", lastName: "Lovelace", companyDomain: "example.com", linkedinUrl: "https://www.linkedin.com/in/ada" };

test("searchContact posts the contact with clientReferenceId = personId and the api_key header", async () => {
  const { fn, calls } = fakeFetch(() => json(fixture("search-matched.json")));
  const res = await searchContact(KEY, fn, person);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.lusha.com/v3/contacts/search");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>).api_key, KEY);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    contacts: [{ clientReferenceId: "person-aaa", firstName: "Ada", lastName: "Lovelace", companyDomain: "example.com", linkedinUrl: "https://www.linkedin.com/in/ada" }],
  });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal((res.body as any).requestId, "00000000-0000-4000-8000-000000000001");
});

test("rate-limit headers are surfaced", async () => {
  const { fn } = fakeFetch(() => json("{}", 200, { "x-rate-limit-daily": "100", "x-daily-requests-left": "97", "x-minute-requests-left": "x" }));
  const res = await searchContact(KEY, fn, person);
  assert.deepEqual(res.rateLimit.daily, { limit: 100, left: 97 });
  assert.deepEqual(res.rateLimit.minute, { limit: null, left: null });
});

test("an email reveal always sends reveal:[\"emails\"] and a phone reveal [\"phones\"], never both or none", async () => {
  for (const field of ["emails", "phones"] as const) {
    const { fn, calls } = fakeFetch(() => json(fixture("unverified-enrich-emails.json")));
    await enrichContact(KEY, fn, "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA", field);
    assert.equal(calls[0].url, "https://api.lusha.com/v3/contacts/enrich");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { ids: ["v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA"], reveal: [field] });
  }
});

test("reveal is a required parameter: omitting it is a type error and a runtime refusal", async () => {
  const { fn, calls } = fakeFetch(() => json("{}"));
  // @ts-expect-error reveal is required (omitting it makes Lusha return both fields and spend 5 extra credits)
  const attempt = enrichContact(KEY, fn, "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA");
  await assert.rejects(attempt, TypeError);
  assert.equal(calls.length, 0, "nothing is sent without an explicit field");
});

for (const status of [401, 402, 403, 429, 451, 500, 503]) {
  test(`HTTP ${status} is called exactly once (no retry) and carries its status`, async () => {
    const { fn, calls } = fakeFetch(() => json(fixture("unverified-http-451.json"), status));
    await assert.rejects(enrichContact(KEY, fn, "id", "emails"), (e: unknown) => {
      assert.ok(e instanceof LushaError);
      assert.equal(e.httpStatus, status);
      assert.ok(!e.message.includes(KEY));
      return true;
    });
    assert.equal(calls.length, 1);
  });
}

test("a status maps to its kind and the real status keeps a 4xx from reading as retryable", async () => {
  const { fn } = fakeFetch(() => json("{}", 404));
  try {
    await searchContact(KEY, fn, person);
    assert.fail("expected a throw");
  } catch (e) {
    assert.ok(e instanceof LushaError);
    assert.equal(e.kind, "unavailable");
    assert.equal(isRetryableByBd(e.kind, e.httpStatus), false);
  }
});

test("a transport error or timeout maps to unavailable, is called once, and never leaks the key", async () => {
  let n = 0;
  const fn: FetchFn = async () => {
    n++;
    throw new Error(`connect failed with api_key=${KEY}`);
  };
  await assert.rejects(searchContact(KEY, fn, person), (e: unknown) => {
    assert.ok(e instanceof LushaError);
    assert.equal(e.kind, "unavailable");
    assert.equal(e.httpStatus, undefined);
    assert.ok(!String(e.message).includes(KEY));
    assert.ok(!JSON.stringify(e).includes(KEY));
    return true;
  });
  assert.equal(n, 1);
});

test("a 200 with an unreadable body is outcome_unknown and NOT retryable (the credit may be spent)", async () => {
  const { fn, calls } = fakeFetch(() => json("<html>"));
  await assert.rejects(searchContact(KEY, fn, person), (e: unknown) => {
    assert.ok(e instanceof LushaError);
    assert.equal(e.kind, "outcome_unknown");
    assert.equal(e.httpStatus, 200);
    assert.equal(isRetryableByBd(e.kind, e.httpStatus), false);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("redirects are refused so the api_key header is never forwarded cross-origin", async () => {
  const { fn, calls } = fakeFetch(() => json("{}"));
  await searchContact(KEY, fn, person);
  assert.equal(calls[0].init.redirect, "error");
});

test("exactly one id per enrich: empty, blank, non-string or array ids are refused before any request", async () => {
  const { fn, calls } = fakeFetch(() => json("{}"));
  for (const bad of ["", "  ", ["a", "b"], null, undefined, 5]) {
    await assert.rejects(enrichContact(KEY, fn, bad as never, "phones"), TypeError);
  }
  await assert.rejects(enrichContact(KEY, fn, "id", "both" as never), TypeError);
  assert.equal(calls.length, 0);
});

test("getAccountUsage is free, non-blocking and never throws", async () => {
  const ok = fakeFetch(() => json('{"used":1}'));
  assert.deepEqual(await getAccountUsage(KEY, ok.fn), { ok: true, body: { used: 1 } });
  assert.equal(ok.calls[0].url, "https://api.lusha.com/v3/account/usage");
  assert.equal(ok.calls[0].init.method, "GET");
  const bad = fakeFetch(() => json("{}", 500));
  assert.deepEqual(await getAccountUsage(KEY, bad.fn), { ok: false });
  const boom: FetchFn = async () => {
    throw new Error("down");
  };
  assert.deepEqual(await getAccountUsage(KEY, boom), { ok: false });
});

test("client.ts never reads process.env or binds the global fetch", () => {
  const src = readFileSync(join(__dirname, "../../src/lib/lusha/client.ts"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/process\.env/.test(src));
  assert.ok(!/globalThis\.fetch|[^.\w]fetch\(/.test(src));
});
