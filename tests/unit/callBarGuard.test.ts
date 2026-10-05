/**
 * A late server reply must never resurrect a bar the user already dismissed,
 * or open one on a page the user has left (call-logging-one-tap, W3).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mayOpenBar, mayRestoreBar } from "@/lib/contacts/callBarGuard";

test("a failed save restores the bar only while that same attempt's bar is still open", () => {
  assert.equal(mayRestoreBar("att-1", "att-1"), true);
  assert.equal(mayRestoreBar(null, "att-1"), false); // dismissed with Escape or by navigating
  assert.equal(mayRestoreBar("att-2", "att-1"), false); // replaced by a newer dial
});

test("a recorded attempt opens its bar only on the page where it was dialled", () => {
  assert.equal(mayOpenBar("/contacts", "/contacts"), true);
  assert.equal(mayOpenBar("/contacts", "/contacts/abc"), false);
});
