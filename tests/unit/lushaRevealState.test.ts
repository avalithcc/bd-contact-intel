import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRevealState, type LedgerRow } from "../../src/lib/lusha/revealState";
import type { LushaConfigResult } from "../../src/lib/lusha/config";

const ok: LushaConfigResult = { ok: true, config: { apiKey: "k" } };
const open = { spentToday: 0, spentCycle: 0, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null };
const canReveal = [
  { field: "emails", credits: 1 },
  { field: "phones", credits: 5 },
];
const AT = "2026-10-14T12:00:00Z";
const search = (outcome: string, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  id: "s1",
  searchId: "s1",
  at: AT,
  field: "search",
  state: "settled",
  outcome,
  value: null,
  payload: { canReveal },
  ...extra,
});
const row = (field: "emails" | "phones", outcome: string | null, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  id: `${field}-1`,
  searchId: "s1",
  at: AT,
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
  assert.deepEqual(resolveRevealState("emails", rows, { spentToday: 99, spentCycle: 99, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok), { kind: "revealed", value: "a@x.invalid" });
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
  assert.deepEqual(resolveRevealState("phones", rows, { spentToday: 8, spentCycle: 8, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok), { kind: "capped", cap: "daily", remaining: 4, needed: 5 });
  assert.deepEqual(resolveRevealState("phones", rows, { spentToday: 7, spentCycle: 7, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok), { kind: "revealable", price: 5 });
  assert.deepEqual(resolveRevealState("emails", {}, { spentToday: 12, spentCycle: 12, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok), { kind: "capped", cap: "daily", remaining: 0, needed: 1 });
});

test("a stored price of 0 still goes through the cap: a stale zero is never an uncapped action", () => {
  const rows = { search: search("matched", { payload: { canReveal: [{ field: "emails", credits: 0 }] } }) };
  assert.deepEqual(resolveRevealState("emails", rows, { spentToday: 12, spentCycle: 12, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok), { kind: "revealable", price: 0 });
  assert.deepEqual(resolveRevealState("emails", rows, { spentToday: 13, spentCycle: 13, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok), { kind: "capped", cap: "daily", remaining: 0, needed: 0 });
});

test("a NEGATIVE field row from an OLDER search never wins over the current search (re-search stays possible)", () => {
  const current = search("matched", { id: "s2", searchId: "s2" });
  const staleNoValue = row("emails", "no_value", { searchId: "s1" });
  assert.deepEqual(resolveRevealState("emails", { search: current, emails: staleNoValue }, open, ok), { kind: "revealable", price: 1 });
  // the same rows tied to the CURRENT search do count
  assert.equal(resolveRevealState("emails", { search: current, emails: row("emails", "no_value", { searchId: "s2" }) }, open, ok).kind, "unavailable");
});

test("compliance stays global across searches", () => {
  const current = search("matched", { id: "s2", searchId: "s2" });
  assert.deepEqual(resolveRevealState("emails", { search: current, complianceBlocked: true }, open, ok), { kind: "blocked" });
  assert.deepEqual(resolveRevealState("emails", { search: current, phones: row("phones", "compliance_restricted", { searchId: "s1" }) }, open, ok), { kind: "blocked" });
});

test("retry states are gated on the cap too: no button the server would refuse", () => {
  const spent = { spentToday: 12, spentCycle: 12, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null };
  assert.deepEqual(resolveRevealState("emails", { search: search("match_rejected") }, spent, ok), { kind: "capped", cap: "daily", remaining: 0, needed: 1 });
  assert.deepEqual(resolveRevealState("emails", { search: search("no_match") }, spent, ok), { kind: "capped", cap: "daily", remaining: 0, needed: 1 });
  assert.deepEqual(resolveRevealState("emails", { search: search("matched"), emails: row("emails", "no_value") }, spent, ok), { kind: "capped", cap: "daily", remaining: 0, needed: 1 });
  assert.equal(resolveRevealState("emails", { search: search("match_rejected") }, { spentToday: 11, spentCycle: 11, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok).kind, "rejected");
});

test("a canReveal list with junk entries does not throw", () => {
  const rows = { search: search("matched", { payload: { canReveal: [null, "x", 3, { field: "emails", credits: 1 }] } }) };
  assert.deepEqual(resolveRevealState("emails", rows, open, ok), { kind: "revealable", price: 1 });
});

test("a cap of 0 (soft kill switch) caps every spend", () => {
  assert.equal(resolveRevealState("emails", {}, { spentToday: 0, spentCycle: 0, dailyCap: 0, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok).kind, "capped");
});

test("revealState.ts is pure: no IO, no db, no env", () => {
  const src = readFileSync(join(__dirname, "../../src/lib/lusha/revealState.ts"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/process\.env|@\/db|from "\.\/client"|fetch/.test(src));
});

test("a revealed VALUE is person-level: a paid row on an older search wins over a newer matched search", () => {
  const current = search("matched", { id: "s2", searchId: "s2" });
  const paid = row("emails", "revealed", { searchId: "s1", value: "person-a@x.invalid" });
  assert.deepEqual(resolveRevealState("emails", { search: current, emails: paid }, open, ok), { kind: "revealed", value: "person-a@x.invalid" });
  // even with the cap spent, a value we own is served from the ledger
  assert.equal(resolveRevealState("emails", { search: current, emails: paid }, { spentToday: 12, spentCycle: 12, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok).kind, "revealed");
  // the other field is untouched by it
  assert.deepEqual(resolveRevealState("phones", { search: current, emails: paid }, open, ok), { kind: "revealable", price: 5 });
});

test("a phone Lusha returned that we already held is unavailable with no retry (the same number comes back)", () => {
  const rows = { search: search("matched"), phones: row("phones", "already_held", { value: "+54 11 5555 5555" }) };
  assert.deepEqual(resolveRevealState("phones", rows, open, ok), { kind: "unavailable", reason: "already_held", retry: false });
});

test("capped carries WHICH cap refused: monthly wins when both would", () => {
  const rows = { search: search("matched") };
  assert.deepEqual(resolveRevealState("phones", rows, { spentToday: 1, spentCycle: 397, dailyCap: 60, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok), { kind: "capped", cap: "monthly", remaining: 3, needed: 5 });
  assert.deepEqual(resolveRevealState("phones", rows, { spentToday: 58, spentCycle: 100, dailyCap: 60, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok), { kind: "capped", cap: "daily", remaining: 2, needed: 5 });
  assert.equal(resolveRevealState("phones", rows, { spentToday: 60, spentCycle: 400, dailyCap: 60, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok).kind === "capped" && (resolveRevealState("phones", rows, { spentToday: 60, spentCycle: 400, dailyCap: 60, monthlyCap: 400, actorSpentToday: 0, personalCap: null }, ok) as { cap: string }).cap, "monthly");
});
