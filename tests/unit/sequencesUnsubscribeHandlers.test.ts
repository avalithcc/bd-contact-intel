import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleUnsubscribeGet,
  handleUnsubscribePost,
  type UnsubscribePort,
} from "@/lib/sequences/unsubscribeHandlers";
import { generateUnsubscribeToken, hashUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

const EMAIL = "brian.casteel@upshop.com";

function fakePort(known: Map<string, string>) {
  const calls = { find: 0, suppress: 0 };
  const port: UnsubscribePort = {
    async findToken(hash) {
      calls.find += 1;
      const email = known.get(hash);
      return email ? { email } : null;
    },
    async suppressByToken(hash) {
      calls.suppress += 1;
      const email = known.get(hash);
      return email ? { email } : null;
    },
  };
  return { port, calls };
}

test("GET with a valid token renders the confirm view and performs zero writes", async () => {
  const token = generateUnsubscribeToken();
  const { port, calls } = fakePort(new Map([[hashUnsubscribeToken(token), EMAIL]]));
  const view = await handleUnsubscribeGet(token, { findToken: port.findToken });
  assert.deepEqual(view, { kind: "confirm", email: EMAIL, token });
  assert.equal(calls.find, 1);
  assert.equal(calls.suppress, 0);
});

test("GET is handed a read-only port: a throwing writer is never reached", async () => {
  const token = generateUnsubscribeToken();
  const readOnly = {
    findToken: async () => ({ email: EMAIL }),
    suppressByToken: async () => {
      throw new Error("GET must never write");
    },
  };
  const view = await handleUnsubscribeGet(token, readOnly);
  assert.equal(view.kind, "confirm");
});

test("GET with an unknown token is the generic invalid view and names no address", async () => {
  const { port } = fakePort(new Map());
  const view = await handleUnsubscribeGet(generateUnsubscribeToken(), { findToken: port.findToken });
  assert.deepEqual(view, { kind: "invalid" });
});

test("GET with a malformed or missing token never reaches the database", async () => {
  const { port, calls } = fakePort(new Map());
  for (const bad of ["", "nope", null, undefined]) {
    assert.deepEqual(await handleUnsubscribeGet(bad, { findToken: port.findToken }), { kind: "invalid" });
  }
  assert.equal(calls.find, 0);
});

test("POST with a valid token suppresses and renders done", async () => {
  const token = generateUnsubscribeToken();
  const { port, calls } = fakePort(new Map([[hashUnsubscribeToken(token), EMAIL]]));
  const view = await handleUnsubscribePost({ queryToken: null, formToken: token, oneClick: false }, port);
  assert.deepEqual(view, { kind: "done", email: EMAIL });
  assert.equal(calls.suppress, 1);
});

test("POST accepts the RFC 8058 one-click shape: token in the query, no form token", async () => {
  const token = generateUnsubscribeToken();
  const { port, calls } = fakePort(new Map([[hashUnsubscribeToken(token), EMAIL]]));
  const view = await handleUnsubscribePost({ queryToken: token, formToken: null, oneClick: true }, port);
  assert.deepEqual(view, { kind: "done", email: EMAIL });
  assert.equal(calls.suppress, 1);
});

test("a repeat POST renders the same done view", async () => {
  const token = generateUnsubscribeToken();
  const { port } = fakePort(new Map([[hashUnsubscribeToken(token), EMAIL]]));
  const first = await handleUnsubscribePost({ queryToken: token, formToken: null, oneClick: false }, port);
  const second = await handleUnsubscribePost({ queryToken: token, formToken: null, oneClick: false }, port);
  assert.deepEqual(second, first);
});

test("POST with an invalid token writes nothing and is generic", async () => {
  const { port, calls } = fakePort(new Map());
  const unknown = await handleUnsubscribePost(
    { queryToken: generateUnsubscribeToken(), formToken: null, oneClick: false },
    port,
  );
  const malformed = await handleUnsubscribePost({ queryToken: "x", formToken: null, oneClick: true }, port);
  assert.deepEqual(unknown, { kind: "invalid" });
  assert.deepEqual(malformed, { kind: "invalid" });
  assert.equal(calls.suppress, 1); // only the well-formed unknown token reached the port; it matched nothing
});

test("the query token wins over a form token when both are present", async () => {
  const good = generateUnsubscribeToken();
  const other = generateUnsubscribeToken();
  const { port } = fakePort(new Map([[hashUnsubscribeToken(good), EMAIL]]));
  const view = await handleUnsubscribePost({ queryToken: good, formToken: other, oneClick: false }, port);
  assert.equal(view.kind, "done");
});
