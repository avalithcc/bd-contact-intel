import assert from "node:assert/strict";
import { test } from "node:test";
import { handleUnsubscribeGetRequest, handleUnsubscribePostRequest, unsubscribeDocument } from "@/lib/sequences/unsubscribeRequest";
import type { UnsubscribePort, UnsubscribeView } from "@/lib/sequences/unsubscribeHandlers";
import { generateUnsubscribeToken, hashUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

const TOKEN = generateUnsubscribeToken();
const OTHER = generateUnsubscribeToken();

function harness(known: string[] = [TOKEN]) {
  const calls = { find: [] as string[], suppress: [] as string[], address: [] as string[] };
  const hashes = new Set(known.map(hashUnsubscribeToken));
  const port: UnsubscribePort = {
    async findToken(hash) {
      calls.find.push(hash);
      return hashes.has(hash) ? { email: "person@example.test" } : null;
    },
    async suppressByToken(hash) {
      calls.suppress.push(hash);
      return hashes.has(hash) ? { email: "person@example.test" } : null;
    },
  };
  const deps = {
    port,
    addressFor: async (hash: string) => (calls.address.push(hash), "1 Test Street"),
    render: (view: UnsubscribeView, postalAddress?: string) => `<view kind="${view.kind}" address="${postalAddress ?? ""}">`,
  };
  return { calls, deps };
}

const get = (query: string) => new Request(`https://example.test/api/unsubscribe${query}`);
const post = (query: string, body: string) =>
  new Request(`https://example.test/api/unsubscribe${query}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });

test("GET with a valid token renders the confirmation and WRITES NOTHING", async () => {
  const h = harness();
  const res = await handleUnsubscribeGetRequest(get(`?t=${TOKEN}`), h.deps);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /kind="confirm"/);
  assert.deepEqual(h.calls.suppress, []);
  assert.equal(h.calls.find.length, 1);
});

test("GET never reaches the write path even when the port has one (mail scanners open every link)", async () => {
  const h = harness();
  for (const query of [`?t=${TOKEN}`, `?t=${OTHER}`, "?t=short", "", `?t=${TOKEN}&t=${OTHER}`]) await handleUnsubscribeGetRequest(get(query), h.deps);
  assert.deepEqual(h.calls.suppress, []);
});

test("GET with an unknown or malformed token is the generic invalid page, with no address", async () => {
  const h = harness();
  for (const query of [`?t=${OTHER}`, "?t=short", ""]) {
    const res = await handleUnsubscribeGetRequest(get(query), h.deps);
    assert.equal(res.status, 404, query);
    assert.match(await res.text(), /kind="invalid" address=""/);
  }
  assert.deepEqual(h.calls.address, []);
});

test("POST with the token in the URL (RFC 8058 one-click) suppresses and shows done", async () => {
  const h = harness();
  const res = await handleUnsubscribePostRequest(post(`?t=${TOKEN}`, "List-Unsubscribe=One-Click"), h.deps);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /kind="done"/);
  assert.deepEqual(h.calls.suppress, [hashUnsubscribeToken(TOKEN)]);
});

test("POST from the confirmation form (token in the body) suppresses", async () => {
  const h = harness();
  const res = await handleUnsubscribePostRequest(post("", `t=${TOKEN}`), h.deps);
  assert.match(await res.text(), /kind="done"/);
  assert.deepEqual(h.calls.suppress, [hashUnsubscribeToken(TOKEN)]);
});

test("POST with an unknown token or no body is invalid and suppresses nothing", async () => {
  const h = harness();
  const unknown = await handleUnsubscribePostRequest(post(`?t=${OTHER}`, ""), h.deps);
  assert.equal(unknown.status, 404);
  const bare = await handleUnsubscribePostRequest(new Request("https://example.test/api/unsubscribe", { method: "POST" }), h.deps);
  assert.equal(bare.status, 404);
  assert.match(await bare.text(), /kind="invalid"/);
});

test("the recipient's postal address comes from the injected lookup, keyed by the token hash", async () => {
  const h = harness();
  const res = await handleUnsubscribeGetRequest(get(`?t=${TOKEN}`), h.deps);
  assert.match(await res.text(), /address="1 Test Street"/);
  assert.deepEqual(h.calls.address, [hashUnsubscribeToken(TOKEN)]);
});

test("responses are never cached and never leak the URL token through the referrer", async () => {
  const h = harness();
  const res = await handleUnsubscribeGetRequest(get(`?t=${TOKEN}`), h.deps);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
});

test("the document wraps the markup with the stylesheet, and cannot be broken out of by it", () => {
  const html = unsubscribeDocument("<div>body</div>", ".a{color:red}");
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<style>\.a\{color:red\}<\/style>/);
  assert.match(html, /<meta name="robots" content="noindex"/);
  assert.match(html, /<div>body<\/div>/);
});
