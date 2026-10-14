import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRevealState, type LedgerRow } from "../../src/lib/lusha/revealState";
import type { LushaConfigResult } from "../../src/lib/lusha/config";

const ok: LushaConfigResult = { ok: true, config: { apiKey: "k" } };
const open = { spentToday: 0, cap: 12 };
const canReveal = [
  { field: "emails", credits: 1 },
  { field: "phones", credits: 5 },
];
const search = (outcome: string, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  field: "search",
  state: "settled",
  outcome,
  value: null,
  payload: { canReveal },
  ...extra,
});
const row = (field: "emails" | "phones", outcome: string | null, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  field,
  state: "settled",
  outcome,
  value: null,
  payload: {},
  ...extra,
});

test("off and unconfigured come from the production gate and win over everything", () => {
  assert.deepEqual(resolveRevealState("emails", {}, open, { ok: false, reason: "not_production" }), { kind: "off" });
  assert.deepEqual(resolveRevealState("emails", { search: search("matched") }, open, { ok: false, reason: "missing_env", missing: ["LUSHA_API_KEY"] }), {
    kind: "unconfigured",
    missing: ["LUSHA_API_KEY"],
  });
});

test("no search yet is searchable at the search price", () => {
  assert.deepEqual(resolveRevealState("emails", {}, open, ok), { kind: "searchable", cost: 1 });
});

test("a matched search is revealable at the stored per-field price, and is reused for both fields", () => {
  const rows = { search: search("matched") };
  assert.deepEqual(resolveRevealState("emails", rows, open, ok), { kind: "revealable", price: 1 });
  assert.deepEqual(resolveRevealState("phones", rows, open, ok), { kind: "revealable", price: 5 });
});

test("a phone paid after the email never offers a second search", () => {
  const rows = { search: search("matched"), emails: row("emails", "revealed", { value: "a@x.invalid" }) };
  assert.equal(resolveRevealState("phones", rows, open, ok).kind, "revealable");
});

test("a revealed value is served from the ledger with no spend", () => {
  const rows = { search: search("matched"), emails: row("emails", "revealed", { value: "a@x.invalid" }) };
  assert.deepEqual(resolveRevealState("emails", rows, { spentToday: 99, cap: 12 }, ok), { kind: "revealed", value: "a@x.invalid" });
});

test("match_rejected offers a retry, not an automatic re-offer", () => {
  assert.deepEqual(resolveRevealState("emails", { search: search("match_rejected") }, open, ok), { kind: "rejected", retryCost: 1 });
});

test("no_match and no_value are unavailable and manually retryable", () => {
  assert.deepEqual(resolveRevealState("emails", { search: search("no_match") }, open, ok), { kind: "unavailable", reason: "no_match", retry: true });
  const rows = { search: search("matched"), emails: row("emails", "no_value") };
  assert.deepEqual(resolveRevealState("emails", rows, open, ok), { kind: "unavailable", reason: "no_value", retry: true });
});

test("canReveal without the field offers no spend, and the other field stays offered", () => {
  const rows = { search: search("matched", { payload: { canReveal: [{ field: "phones", credits: 5 }] } }) };
  assert.deepEqual(resolveRevealState("emails", rows, open, ok), { kind: "unavailable", reason: "not_revealable", retry: false });
  assert.deepEqual(resolveRevealState("phones", rows, open, ok), { kind: "revealable", price: 5 });
});

test("a matched search with no stored price list offers nothing, never a guess", () => {
  const rows = { search: search("matched", { payload: {} }) };
  assert.equal(resolveRevealState("emails", rows, open, ok).kind, "unavailable");
});

test("compliance_restricted offers nothing and blocks the whole Contact, both fields", () => {
  const rows = { search: search("matched"), phones: row("phones", "compliance_restricted") };
  assert.deepEqual(resolveRevealState("emails", rows, open, ok), { kind: "blocked" });
  assert.deepEqual(resolveRevealState("phones", rows, open, ok), { kind: "blocked" });
  assert.deepEqual(resolveRevealState("emails", { search: search("compliance_restricted") }, open, ok), { kind: "blocked" });
});

test("a failed or in-flight row does not block a retry", () => {
  assert.deepEqual(resolveRevealState("emails", { search: search("matched"), emails: row("emails", null, { state: "failed" }) }, open, ok), { kind: "revealable", price: 1 });
  assert.deepEqual(resolveRevealState("emails", { search: search(null as never, { state: "failed" }) }, open, ok), { kind: "searchable", cost: 1 });
});

test("capped names the remaining budget; exactly-at-cap is still allowed", () => {
  const rows = { search: search("matched") };
  assert.deepEqual(resolveRevealState("phones", rows, { spentToday: 8, cap: 12 }, ok), { kind: "capped", remaining: 4, needed: 5 });
  assert.deepEqual(resolveRevealState("phones", rows, { spentToday: 7, cap: 12 }, ok), { kind: "revealable", price: 5 });
  assert.deepEqual(resolveRevealState("emails", {}, { spentToday: 12, cap: 12 }, ok), { kind: "capped", remaining: 0, needed: 1 });
});

test("a price of 0 (already revealed for the account) is free and never capped", () => {
  const rows = { search: search("matched", { payload: { canReveal: [{ field: "emails", credits: 0 }] } }) };
  assert.deepEqual(resolveRevealState("emails", rows, { spentToday: 12, cap: 12 }, ok), { kind: "revealable", price: 0 });
});

test("a cap of 0 (soft kill switch) caps every spend", () => {
  assert.equal(resolveRevealState("emails", {}, { spentToday: 0, cap: 0 }, ok).kind, "capped");
});

test("revealState.ts is pure: no IO, no db, no env", () => {
  const src = readFileSync(join(__dirname, "../../src/lib/lusha/revealState.ts"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/process\.env|@\/db|from "\.\/client"|fetch/.test(src));
});
