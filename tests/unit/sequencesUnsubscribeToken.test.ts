import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildUnsubscribeUrl,
  generateUnsubscribeToken,
  hashUnsubscribeToken,
  isWellFormedUnsubscribeToken,
} from "@/lib/sequences/unsubscribeToken";

test("a generated token is 256 bits of base64url and well formed", () => {
  const token = generateUnsubscribeToken();
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(isWellFormedUnsubscribeToken(token), true);
});

test("two generated tokens differ", () => {
  assert.notEqual(generateUnsubscribeToken(), generateUnsubscribeToken());
});

test("the hash is deterministic, differs from the token and is a sha256 hex digest", () => {
  const token = generateUnsubscribeToken();
  const hash = hashUnsubscribeToken(token);
  assert.equal(hash, hashUnsubscribeToken(token));
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("malformed input is rejected before any lookup", () => {
  for (const bad of ["", "short", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}!`, `${"a".repeat(42)} `, null, undefined]) {
    assert.equal(isWellFormedUnsubscribeToken(bad), false, String(bad));
  }
});

test("hashing a malformed token throws instead of producing a hash", () => {
  assert.throws(() => hashUnsubscribeToken("nope"));
});

test("the unsubscribe URL carries the token and survives a trailing slash on the site", () => {
  const token = generateUnsubscribeToken();
  assert.equal(buildUnsubscribeUrl("https://example.test", token), `https://example.test/api/unsubscribe?t=${token}`);
  assert.equal(buildUnsubscribeUrl("https://example.test/", token), `https://example.test/api/unsubscribe?t=${token}`);
});
