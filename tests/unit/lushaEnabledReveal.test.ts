/**
 * lusha-per-bd: a BD whose Lusha switch is off is refused SERVER-SIDE, before any read, reservation or Lusha call.
 * Every port except the switch and the config throws, so a single stray call fails the test. Lusha is never reached.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { revealLushaField, searchLushaContact, type RevealPorts } from "@/lib/lusha/reveal";

function ports(enabled: boolean): { p: RevealPorts; calls: string[] } {
  const calls: string[] = [];
  const boom = (name: string) => async () => {
    calls.push(name);
    throw new Error(`${name} must not be reached for a disabled BD`);
  };
  const p = {
    config: { ok: true, config: { apiKey: "sk-test-never-used" } },
    cap: 12,
    isLushaEnabled: async (bdId: string) => {
      calls.push(`isLushaEnabled:${bdId}`);
      return enabled;
    },
    assertEditable: boom("assertEditable"),
    loadSubject: boom("loadSubject"),
    getRevealState: boom("getRevealState"),
    getDailySpend: boom("getDailySpend"),
    reserve: boom("reserve"),
    settleSearch: boom("settleSearch"),
    settleReveal: boom("settleReveal"),
    failReservation: boom("failReservation"),
    rejectMatch: boom("rejectMatch"),
    searchContact: boom("searchContact"),
    enrichContact: boom("enrichContact"),
    getAccountUsage: boom("getAccountUsage"),
  } as unknown as RevealPorts;
  return { p, calls };
}

const input = { personId: "person-1", field: "emails" as const, actorBdId: "bd-off", expect: { searchId: "s1", price: 1 } };

test("a disabled BD's search is refused with a typed reason, before anything is read, reserved or called", async () => {
  const { p, calls } = ports(false);
  const r = await searchLushaContact(input, p);
  assert.deepEqual([r.ok, !r.ok && r.reason, !r.ok && r.retryable, !r.ok && r.permanent], [false, "lusha_not_enabled", false, false]);
  assert.deepEqual(calls, ["isLushaEnabled:bd-off"]);
});

test("a disabled BD's reveal is refused the same way: no reservation, no Lusha call", async () => {
  const { p, calls } = ports(false);
  const r = await revealLushaField(input, p);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "lusha_not_enabled"]);
  assert.deepEqual(calls, ["isLushaEnabled:bd-off"]);
});

test("the switch is read for the acting BD, and an enabled BD gets past it", async () => {
  const { p, calls } = ports(true);
  await assert.rejects(() => searchLushaContact(input, p), /assertEditable must not be reached/);
  assert.deepEqual(calls, ["isLushaEnabled:bd-off", "assertEditable"]);
});
