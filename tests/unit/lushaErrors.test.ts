import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LUSHA_ERROR_KINDS,
  LushaError,
  isPermanent,
  isRetryableByBd,
  kindFromContactCode,
  kindFromHttpStatus,
  type LushaErrorKind,
} from "../../src/lib/lusha/errors";

test("the taxonomy lists exactly the thirteen kinds of the design", () => {
  assert.deepEqual([...LUSHA_ERROR_KINDS].sort(), [
    "async_unsupported",
    "bad_key",
    "busy",
    "cap_exceeded",
    "compliance_blocked",
    "compliance_restricted",
    "enrich_failed",
    "no_credits",
    "not_found",
    "plan_denied",
    "rate_limited",
    "unavailable",
    "unparsable_value",
  ]);
});

test("HTTP statuses map to their kind", () => {
  assert.equal(kindFromHttpStatus(401), "bad_key");
  assert.equal(kindFromHttpStatus(402), "no_credits");
  assert.equal(kindFromHttpStatus(403), "plan_denied");
  assert.equal(kindFromHttpStatus(429), "rate_limited");
  assert.equal(kindFromHttpStatus(451), "compliance_blocked");
  for (const s of [500, 502, 503, 504, 599]) assert.equal(kindFromHttpStatus(s), "unavailable");
});

test("success statuses map to no error", () => {
  for (const s of [200, 201, 204]) assert.equal(kindFromHttpStatus(s), null);
});

test("an unexpected failing status fails closed as unavailable", () => {
  for (const s of [400, 404, 418]) assert.equal(kindFromHttpStatus(s), "unavailable");
});

test("per-contact body codes map to their kind", () => {
  assert.equal(kindFromContactCode("NOT_FOUND"), "not_found");
  assert.equal(kindFromContactCode("COMPLIANCE_RESTRICTED"), "compliance_restricted");
  assert.equal(kindFromContactCode("ENRICH_FAILED"), "enrich_failed");
});

test("WATERFALL_NOT_IN_PLAN and unrelated unknown codes are not errors", () => {
  assert.equal(kindFromContactCode("WATERFALL_NOT_IN_PLAN"), null);
  assert.equal(kindFromContactCode("SOMETHING_NEW"), null);
  assert.equal(kindFromContactCode(undefined), null);
});

// Exhaustive decision table: adding a kind without deciding it fails here.
const DECISIONS: Record<LushaErrorKind, { permanent: boolean; retryableByBd: boolean }> = {
  bad_key: { permanent: false, retryableByBd: false },
  no_credits: { permanent: false, retryableByBd: false },
  plan_denied: { permanent: false, retryableByBd: false },
  rate_limited: { permanent: false, retryableByBd: true },
  compliance_blocked: { permanent: true, retryableByBd: false },
  unavailable: { permanent: false, retryableByBd: true },
  not_found: { permanent: false, retryableByBd: true },
  compliance_restricted: { permanent: true, retryableByBd: false },
  enrich_failed: { permanent: false, retryableByBd: true },
  async_unsupported: { permanent: false, retryableByBd: false },
  unparsable_value: { permanent: false, retryableByBd: false },
  cap_exceeded: { permanent: false, retryableByBd: false },
  busy: { permanent: false, retryableByBd: true },
};

test("every kind has an explicit permanence and retry decision", () => {
  assert.deepEqual(Object.keys(DECISIONS).sort(), [...LUSHA_ERROR_KINDS].sort());
  for (const kind of LUSHA_ERROR_KINDS) {
    assert.equal(isPermanent(kind), DECISIONS[kind].permanent, `isPermanent(${kind})`);
    assert.equal(isRetryableByBd(kind), DECISIONS[kind].retryableByBd, `isRetryableByBd(${kind})`);
  }
});

test("only compliance outcomes are permanent (D6)", () => {
  const permanent = LUSHA_ERROR_KINDS.filter(isPermanent);
  assert.deepEqual([...permanent].sort(), ["compliance_blocked", "compliance_restricted"]);
});

test("a permanent kind is never retryable by the BD", () => {
  for (const kind of LUSHA_ERROR_KINDS) if (isPermanent(kind)) assert.equal(isRetryableByBd(kind), false);
});

test("LushaError carries the kind and exposes no retry or backoff field", () => {
  const e = new LushaError("rate_limited");
  assert.ok(e instanceof Error);
  assert.equal(e.kind, "rate_limited");
  const fields = Object.keys(e).join(",").toLowerCase();
  assert.doesNotMatch(fields, /retry|backoff|attempt|delay/);
});

test("LushaError defaults its message to the kind, never to request data", () => {
  assert.equal(new LushaError("bad_key").message, "bad_key");
});

test("any compliance-looking code is permanent, whatever its case or spelling", () => {
  for (const code of ["compliance_restricted", "Compliance_Restricted", "COMPLIANCE_BLOCKED", " COMPLIANCE_NEW ", "CONTACT_COMPLIANCE"]) {
    assert.equal(kindFromContactCode(code), "compliance_restricted", code);
  }
});

test("known codes are matched case-insensitively", () => {
  assert.equal(kindFromContactCode("not_found"), "not_found");
  assert.equal(kindFromContactCode("enrich_failed"), "enrich_failed");
});

test("a 4xx other than 429 is not retryable by the BD, whatever the kind", () => {
  for (const status of [400, 404, 418]) {
    const kind = kindFromHttpStatus(status);
    assert.ok(kind);
    assert.equal(isRetryableByBd(kind, status), false, String(status));
  }
});

test("429 and 5xx keep their retry decision when the status is passed", () => {
  assert.equal(isRetryableByBd("rate_limited", 429), true);
  assert.equal(isRetryableByBd("unavailable", 503), true);
});
