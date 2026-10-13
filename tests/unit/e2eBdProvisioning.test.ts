import { test } from "node:test";
import assert from "node:assert/strict";
import {
  READ_ONLY_MARKER_HEADER,
  mayProvisionBd,
  withReadOnlyMarker,
} from "../../src/lib/auth/bdProvisioning";

// The producer (tests/e2e/fixtures.ts) and the reader (getCurrentBd) share this
// module, so fixtures here come from the real producer, never typed by hand.
const markedHeaders = () => new Headers(withReadOnlyMarker({ accept: "text/html" }));

test("a first visit still provisions the bd row when nothing marks the request", () => {
  assert.equal(mayProvisionBd(new Headers({ accept: "text/html" }), "development"), true);
  assert.equal(mayProvisionBd(new Headers(), "production"), true);
  assert.equal(mayProvisionBd(new Headers(), undefined), true);
});

test("a read-only e2e request, as the real producer marks it, may not provision", () => {
  assert.equal(mayProvisionBd(markedHeaders(), "development"), false);
  assert.equal(mayProvisionBd(markedHeaders(), "test"), false);
  assert.equal(mayProvisionBd(markedHeaders(), undefined), false);
});

test("production ignores the marker, so a real BD can never lose their first-visit row", () => {
  assert.equal(mayProvisionBd(markedHeaders(), "production"), true);
});

test("only the exact marker value disables provisioning", () => {
  for (const v of ["", "0", "true", "yes", "11"]) {
    assert.equal(mayProvisionBd(new Headers({ [READ_ONLY_MARKER_HEADER]: v }), "development"), true, JSON.stringify(v));
  }
});

test("withReadOnlyMarker never mutates its input and is repeatable", () => {
  const input = { accept: "text/html" };
  const first = withReadOnlyMarker(input);
  const second = withReadOnlyMarker(input);
  assert.deepEqual(input, { accept: "text/html" });
  assert.deepEqual(first, second);
  assert.notEqual(first, input);
});

test("the marker overrides a caller-supplied value regardless of header casing", () => {
  const out = withReadOnlyMarker({ [READ_ONLY_MARKER_HEADER.toUpperCase()]: "0" });
  assert.equal(mayProvisionBd(new Headers(out), "development"), false);
});
