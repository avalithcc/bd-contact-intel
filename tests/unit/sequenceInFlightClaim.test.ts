/**
 * A `pending` claim younger than five minutes is a send in flight (an "Enviar ahora" a moment ago, or a cron tick): the next
 * run skips it silently. Only a STALE pending claim is the crash case that holds as manual_check.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { evaluatePreSendChecks, IN_FLIGHT_CLAIM_MS, type PreSendFacts } from "@/lib/sequences/preSendChecks";
import { buildUnsubscribeUrl, generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

const NOW = new Date("2026-10-15T14:00:00Z");
const body = (() => {
  const r = appendFooter("Hello", COMPLIANCE_CONFIG, "miami", buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken()));
  return r.status === "ok" ? r.body : "";
})();
const facts = (over: Partial<PreSendFacts>): PreSendFacts => ({
  step: 1, memberState: "approved", draftApproved: true, merged: false, email: "jane@acme.test", hasClientStatus: false, address: "miami", body,
  accountStatus: "connected", activeClaim: null, activeClaimAt: null, repliedAt: null, inboundReplyAt: null, lastSyncedAt: NOW, step1RfcMessageId: null, step1ThreadId: null, ...over,
});
const ctx = { now: NOW, suppression: [] };
const ago = (ms: number) => new Date(NOW.getTime() - ms);

test("a pending claim under five minutes old is skipped silently: no hold reason", () => {
  assert.deepEqual(evaluatePreSendChecks(facts({ activeClaim: "pending", activeClaimAt: ago(60_000) }), ctx), { ok: false, skip: "in_flight" });
  assert.deepEqual(evaluatePreSendChecks(facts({ activeClaim: "pending", activeClaimAt: ago(IN_FLIGHT_CLAIM_MS - 1) }), ctx), { ok: false, skip: "in_flight" });
});

test("a stale pending claim, or one with no known age, still holds as manual_check", () => {
  assert.deepEqual(evaluatePreSendChecks(facts({ activeClaim: "pending", activeClaimAt: ago(IN_FLIGHT_CLAIM_MS) }), ctx), { ok: false, reason: "manual_check" });
  assert.deepEqual(evaluatePreSendChecks(facts({ activeClaim: "pending", activeClaimAt: null }), ctx), { ok: false, reason: "manual_check" });
});

test("a SENT claim is never an in-flight skip: it holds as before", () => {
  assert.deepEqual(evaluatePreSendChecks(facts({ activeClaim: "sent", activeClaimAt: ago(1000) }), ctx), { ok: false, reason: "manual_check" });
});
