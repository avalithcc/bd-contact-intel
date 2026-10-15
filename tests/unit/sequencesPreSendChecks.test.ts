import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG, SEQUENCE_SYNC_STALE_MS } from "@/lib/sequences/config";
import {
  evaluatePreSendChecks,
  extractUnsubscribeUrl,
  HOLD_REASONS,
  type PreSendFacts,
} from "@/lib/sequences/preSendChecks";
import { buildUnsubscribeUrl, generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

const NOW = new Date("2026-10-15T14:00:00Z");
const URL_OK = buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken());

// Fixtures come from the real footer producer, never a hand-typed footer.
function footed(market: "us" | "latam" = "us") {
  const r = appendFooter("Hello Jane, a short note.", COMPLIANCE_CONFIG, market, URL_OK);
  assert.equal(r.status, "ok");
  return r.status === "ok" ? r.body : "";
}

function facts(over: Partial<PreSendFacts> = {}): PreSendFacts {
  return {
    step: 1,
    memberState: "approved",
    draftApproved: true,
    merged: false,
    email: "jane@acme.test",
    hasClientStatus: false,
    market: "us",
    body: footed(),
    accountStatus: "connected",
    activeClaim: null,
    repliedAt: null,
    lastSyncedAt: new Date(NOW.getTime() - 3 * 3600_000),
    step1RfcMessageId: "<abc@mail.gmail.test>",
    step1ThreadId: "thread-1",
    ...over,
  };
}
const reminder = (over: Partial<PreSendFacts> = {}) => facts({ step: 2, memberState: "sent", ...over });
const check = (f: PreSendFacts, suppression: Parameters<typeof evaluatePreSendChecks>[1]["suppression"] = []) =>
  evaluatePreSendChecks(f, { now: NOW, suppression, staleAfterMs: SEQUENCE_SYNC_STALE_MS });
const held = (reason: string) => ({ ok: false, reason });

test("a fully valid step 1 and a fully valid reminder pass", () => {
  assert.deepEqual(check(facts()), { ok: true });
  assert.deepEqual(check(reminder()), { ok: true });
});

test("member no longer approved, or draft approval withdrawn: not_approved", () => {
  assert.deepEqual(check(facts({ memberState: "drafted" })), held("not_approved"));
  assert.deepEqual(check(facts({ draftApproved: false })), held("not_approved"));
  assert.deepEqual(check(reminder({ memberState: "replied" })), held("not_approved"));
  assert.deepEqual(check(reminder({ memberState: "approved" })), held("not_approved"));
});

test("a merged Contact, or one with no email, is held", () => {
  assert.deepEqual(check(facts({ merged: true })), held("merged_contact"));
  assert.deepEqual(check(facts({ email: null })), held("no_email"));
  assert.deepEqual(check(facts({ email: "   " })), held("no_email"));
});

test("suppressed by address (case-insensitive) or by domain: held", () => {
  assert.deepEqual(check(facts({ email: "Jane@Acme.test" }), [{ ruleKind: "address", value: "jane@acme.test" }]), held("suppressed"));
  assert.deepEqual(check(facts(), [{ ruleKind: "domain", value: "acme.test" }]), held("suppressed"));
  assert.deepEqual(check(facts(), [{ ruleKind: "domain", value: "other.test" }]), { ok: true });
});

test("a company that became a client is held", () => {
  assert.deepEqual(check(facts({ hasClientStatus: true })), held("client_company"));
});

test("an unmapped recipient market (`other`) is held and never sent, whatever the body says", () => {
  assert.deepEqual(check(facts({ market: "other" })), held("unmapped_market"));
  assert.deepEqual(check(reminder({ market: "other" })), held("unmapped_market"));
});

test("footer: address deleted, opt-out text deleted, or the per-recipient link deleted: held", () => {
  const ok = footed();
  const noAddress = ok.replace(COMPLIANCE_CONFIG.us!.postalAddress, "");
  const noOptOut = ok.replace(COMPLIANCE_CONFIG.us!.optOutText, "");
  const noLink = ok.replace(URL_OK, "");
  for (const body of [noAddress, noOptOut, noLink]) assert.deepEqual(check(facts({ body })), held("missing_footer"));
  assert.deepEqual(check(facts({ body: footed("latam"), market: "latam" })), { ok: true });
  assert.deepEqual(check(facts({ body: footed("us"), market: "latam" })), held("missing_footer"));
});

test("extractUnsubscribeUrl returns the link the footer producer wrote, and null when there is none", () => {
  assert.equal(extractUnsubscribeUrl(footed()), URL_OK);
  assert.equal(extractUnsubscribeUrl("no link here"), null);
  assert.equal(extractUnsubscribeUrl("http://crm.example.test/api/unsubscribe?t=" + "a".repeat(43)), null, "https only");
});

test("an account that is not connected is held", () => {
  assert.deepEqual(check(facts({ accountStatus: "error" })), held("account_not_connected"));
  assert.deepEqual(check(facts({ accountStatus: "revoked" })), held("account_not_connected"));
});

test("an existing claim is never re-sent: pending (crash, outcome unknown) and sent both surface as manual_check", () => {
  assert.deepEqual(check(facts({ activeClaim: "pending" })), held("manual_check"));
  assert.deepEqual(check(facts({ activeClaim: "sent" })), held("manual_check"));
});

test("reminders only: a recorded reply holds the reminder", () => {
  assert.deepEqual(check(reminder({ repliedAt: new Date("2026-10-14T10:00:00Z") })), held("replied"));
  assert.deepEqual(check(facts({ repliedAt: new Date("2026-10-14T10:00:00Z") })), { ok: true }, "step 1 does not apply the reply check");
});

test("reminders only: stale or never-run sync holds the reminder", () => {
  assert.deepEqual(check(reminder({ lastSyncedAt: new Date(NOW.getTime() - 40 * 3600_000) })), held("sync_stale"));
  assert.deepEqual(check(reminder({ lastSyncedAt: null })), held("sync_stale"));
  assert.deepEqual(check(facts({ lastSyncedAt: null })), { ok: true }, "step 1 does not apply the sync check");
});

test("reminders only: no stored Message-ID or thread for step 1 holds with no_thread_headers, never an unthreaded send", () => {
  assert.deepEqual(check(reminder({ step1RfcMessageId: null })), held("no_thread_headers"));
  assert.deepEqual(check(reminder({ step1ThreadId: null })), held("no_thread_headers"));
  assert.deepEqual(check(facts({ step1RfcMessageId: null, step1ThreadId: null })), { ok: true });
});

test("first failure wins, in a stable order: approval, then claim, then content, then account, then reminder-only", () => {
  assert.deepEqual(check(facts({ memberState: "drafted", activeClaim: "pending", merged: true })), held("not_approved"));
  assert.deepEqual(check(facts({ activeClaim: "pending", merged: true })), held("manual_check"));
  assert.deepEqual(check(facts({ merged: true, accountStatus: "error" })), held("merged_contact"));
  assert.deepEqual(check(reminder({ accountStatus: "error", lastSyncedAt: null })), held("account_not_connected"));
});

test("the HoldReason union is one list, with no duplicates", () => {
  assert.equal(new Set(HOLD_REASONS).size, HOLD_REASONS.length);
  assert.ok(HOLD_REASONS.includes("unmapped_market") && HOLD_REASONS.includes("manual_check") && HOLD_REASONS.includes("no_thread_headers"));
});

test("pure: facts are not mutated and the same input gives the same answer", () => {
  const f = Object.freeze(facts({ merged: true }));
  assert.deepEqual(check(f), check(f));
});
