import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUnsubscribeHeaders } from "@/lib/sequences/unsubscribeHeaders";

const URL_OK = "https://example.test/api/unsubscribe?t=abc";

test("List-Unsubscribe lists the https URI first, then the mailto", () => {
  const [unsub] = buildUnsubscribeHeaders(URL_OK, "sender@example.test");
  assert.equal(unsub, `List-Unsubscribe: <${URL_OK}>, <mailto:sender@example.test?subject=unsubscribe>`);
});

test("List-Unsubscribe-Post carries the RFC 8058 one-click value", () => {
  const headers = buildUnsubscribeHeaders(URL_OK, "sender@example.test");
  assert.equal(headers.length, 2);
  assert.equal(headers[1], "List-Unsubscribe-Post: List-Unsubscribe=One-Click");
});

test("a non-https URL is refused: one-click requires https", () => {
  assert.throws(() => buildUnsubscribeHeaders("http://example.test/x", "sender@example.test"));
});

test("header injection through the URL or the sender is refused", () => {
  assert.throws(() => buildUnsubscribeHeaders(`${URL_OK}\r\nBcc: evil@x.test`, "sender@example.test"));
  assert.throws(() => buildUnsubscribeHeaders(URL_OK, "sender@example.test\r\nBcc: evil@x.test"));
  assert.throws(() => buildUnsubscribeHeaders(`${URL_OK}>, <https://evil.test`, "sender@example.test"));
  assert.throws(() => buildUnsubscribeHeaders(URL_OK, "not an address"));
});
