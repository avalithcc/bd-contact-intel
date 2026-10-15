/**
 * The reveal orchestration (src/lib/lusha/reveal.ts), driven entirely by fakes: no network, no DB, no key.
 * The fixtures are the ones captured (or reconstructed, see their _note) for the parsers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ContactMergedError } from "@/lib/contacts/mergeGuard";
import type { LushaConfigResult } from "@/lib/lusha/config";
import { LUSHA_ERROR_KINDS, LushaError } from "@/lib/lusha/errors";
import { getLushaUsage, rejectLushaMatch, revealLushaField, searchLushaContact, type RevealPorts, type Subject } from "@/lib/lusha/reveal";
import type { LatestRows, LedgerRow } from "@/lib/lusha/revealState";

const KEY = "sk-live-super-secret";
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, "fixtures", "lusha", name), "utf8"));
const response = (body: unknown) => ({ body, rateLimit: { daily: { limit: null, left: null }, hourly: { limit: null, left: null }, minute: { limit: null, left: null } } });

const SUBJECT: Subject = {
  id: "person-aaa",
  firstName: "Example",
  lastName: "Person",
  email: null,
  emailStatus: "none",
  emailSource: null,
  phone: null,
  mobilePhone: null,
  mergedIntoId: null,
  linkedinUrl: "https://www.linkedin.com/in/example-person",
  companyDomain: "example.com",
};
const LUSHA_ID = "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA";
const row = (over: Partial<LedgerRow>): LedgerRow => ({ id: "r", searchId: "s1", at: new Date("2026-10-14T12:00:00Z"), field: "search", state: "settled", outcome: null, value: null, payload: {}, ...over });
const MATCHED = row({
  id: "s1",
  outcome: "matched",
  payload: { lushaContactId: LUSHA_ID, identity: { name: "Example Person", company: "Example Co", domain: "example.com", linkedin: null }, canReveal: [{ field: "emails", credits: 1 }, { field: "phones", credits: 5 }] },
});
const WITH_SEARCH: LatestRows = { search: MATCHED };

interface Fake {
  p: RevealPorts;
  calls: string[];
  last: Record<string, unknown>;
}

/** Ports that record every call. `over` replaces any of them; defaults are the happy path with no network. */
function fake(over: Partial<RevealPorts> & { rows?: LatestRows; subject?: Subject | null; spent?: number } = {}): Fake {
  const calls: string[] = [];
  const last: Record<string, unknown> = {};
  const rec = <T>(name: string, value: T) => async (...args: unknown[]): Promise<T> => {
    calls.push(name);
    last[name] = args[0];
    return value;
  };
  const p: RevealPorts = {
    config: { ok: true, config: { apiKey: KEY } },
    cap: 12,
    assertEditable: rec("assertEditable", undefined),
    loadSubject: rec("loadSubject", over.subject === undefined ? SUBJECT : over.subject),
    getRevealState: rec("getRevealState", over.rows ?? {}),
    getDailySpend: rec("getDailySpend", over.spent ?? 0),
    reserve: rec("reserve", { ok: true as const, reservationId: "res-1", credits: 1, searchId: "s1" }),
    settleSearch: rec("settleSearch", true),
    settleReveal: rec("settleReveal", { outcome: "revealed" as const, value: "x@example.invalid", written: "email" as const, duplicate: null, writeFailed: false }),
    failReservation: rec("failReservation", true),
    rejectMatch: rec("rejectMatch", true),
    searchContact: async (i) => {
      calls.push("searchContact");
      last.searchContact = i;
      return response(fixture("search-matched.json") as never);
    },
    enrichContact: async (id, field) => {
      calls.push("enrichContact");
      last.enrichContact = { id, field };
      return response(fixture("unverified-enrich-emails.json"));
    },
    getAccountUsage: rec("getAccountUsage", { ok: true as const, body: { credits: { total: 40, used: 2 } } }),
    ...over,
  } as RevealPorts;
  return { p, calls, last };
}

const spends = (calls: string[]) => calls.filter((c) => c === "reserve" || c === "searchContact" || c === "enrichContact");
const input = (field: "emails" | "phones" = "emails") => ({ personId: SUBJECT.id, field, actorBdId: "bd-1", expect: { searchId: "s1", price: field === "emails" ? 1 : 5 } });
const ACCOUNT_CALLS = ["searchContact", "enrichContact"];

// --- gates ---------------------------------------------------------------------------------

test("a disabled gate rejects server-side with no reservation and no call", async () => {
  const cases: Array<[LushaConfigResult, string]> = [
    [{ ok: false, reason: "not_production" }, "lusha_off"],
    [{ ok: false, reason: "missing_env", missing: ["LUSHA_API_KEY"] }, "lusha_unconfigured"],
  ];
  for (const [config, reason] of cases) {
    const f = fake({ config });
    const r = await searchLushaContact(input(), f.p);
    assert.deepEqual([r.ok, !r.ok && r.reason], [false, reason]);
    assert.deepEqual((await revealLushaField(input(), f.p)).ok, false);
    assert.deepEqual(spends(f.calls), []);
  }
});

test("a merged Contact is refused before anything is read or reserved", async () => {
  const f = fake({ assertEditable: async () => { throw new ContactMergedError(); } });
  await assert.rejects(() => searchLushaContact(input(), f.p), ContactMergedError);
  await assert.rejects(() => revealLushaField(input(), f.p), ContactMergedError);
  assert.deepEqual(f.calls, []);
});

test("a reachable email is refused even if the UI was bypassed; a pattern-inferred one is not", async () => {
  const reachable = fake({ subject: { ...SUBJECT, email: "a@b.co", emailStatus: "verified", emailSource: "hunter" }, rows: WITH_SEARCH });
  const r = await revealLushaField(input("emails"), reachable.p);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "lusha_not_eligible"]);
  assert.deepEqual(spends(reachable.calls), []);
  assert.equal((await searchLushaContact(input("emails"), reachable.p)).ok, false);
  const inferred = fake({ subject: { ...SUBJECT, email: "a@b.co", emailStatus: "probable", emailSource: "pattern_inferred" }, rows: WITH_SEARCH });
  assert.equal((await revealLushaField(input("emails"), inferred.p)).ok, true);
});

test("a phone is refused only when both columns are occupied", async () => {
  const both = fake({ subject: { ...SUBJECT, phone: "+54 11 5555-0142", mobilePhone: "+54 9 11 5555-0143" }, rows: WITH_SEARCH });
  assert.equal((await revealLushaField(input("phones"), both.p)).ok, false);
  assert.deepEqual(spends(both.calls), []);
});

test("a search with too little to match on is refused before it costs a credit", async () => {
  const f = fake({ subject: { ...SUBJECT, companyDomain: null, linkedinUrl: null } });
  const r = await searchLushaContact(input(), f.p);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "lusha_insufficient_data"]);
  assert.deepEqual(spends(f.calls), []);
});

// --- search --------------------------------------------------------------------------------

test("a search sends exactly one request, never an empty string, and settles the match with its identity and prices", async () => {
  const f = fake({ subject: { ...SUBJECT, companyDomain: null } });
  const r = await searchLushaContact(input(), f.p);
  assert.equal(f.calls.filter((c) => c === "searchContact").length, 1);
  const sent = f.last.searchContact as Record<string, unknown>;
  assert.equal(sent.companyDomain, undefined);
  assert.equal(JSON.stringify({ contacts: [sent] }).includes('""'), false);
  assert.equal(r.ok && r.outcome, "matched");
  const settled = f.last.settleSearch as { outcome: string; lushaContactId: string; creditsCharged: number; payload: { canReveal: unknown[] } };
  assert.deepEqual([settled.outcome, settled.lushaContactId, settled.creditsCharged], ["matched", "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA", 1]);
  assert.equal(settled.payload.canReveal.length, 2);
  assert.equal(r.ok && r.outcome === "matched" ? r.price : null, 1);
});

test("NOT_FOUND settles as no_match with the 0 credits Lusha billed", async () => {
  const f = fake({ searchContact: async () => response(fixture("unverified-search-not-found.json")) });
  const r = await searchLushaContact(input(), f.p);
  assert.deepEqual(r, { ok: true, outcome: "no_match" });
  const settled = f.last.settleSearch as { outcome: string; creditsCharged: number };
  assert.deepEqual([settled.outcome, settled.creditsCharged], ["no_match", 0]);
});

test("a compliance-restricted search settles as the permanent outcome", async () => {
  const f = fake({ searchContact: async () => response(fixture("unverified-search-compliance-restricted.json")) });
  const r = await searchLushaContact(input(), f.p);
  assert.deepEqual([r.ok, !r.ok && r.reason, !r.ok && r.permanent], [false, "lusha_protected", true]);
  assert.equal((f.last.settleSearch as { outcome: string }).outcome, "compliance_restricted");
  assert.equal(f.calls.includes("failReservation"), false);
});

test("a valid stored match is served with no network and no charge", async () => {
  const f = fake({ rows: WITH_SEARCH });
  const r = await searchLushaContact(input(), f.p);
  assert.equal(r.ok && r.outcome === "matched" && r.reused, true);
  assert.deepEqual(spends(f.calls), []);
});

test("after a rejected match an explicit new search is allowed and reserves a search", async () => {
  const f = fake({ rows: { search: { ...MATCHED, outcome: "match_rejected" } } });
  const r = await searchLushaContact(input(), f.p);
  assert.equal(r.ok, true);
  assert.deepEqual((f.last.reserve as { field: string }).field, "search");
});

// --- reveal --------------------------------------------------------------------------------

test("an email reveal asks for one field and one id, once, and settles with Lusha's own billing", async () => {
  const f = fake({ rows: WITH_SEARCH });
  const r = await revealLushaField(input("emails"), f.p);
  assert.deepEqual(f.last.enrichContact, { id: LUSHA_ID, field: "emails" });
  assert.equal(f.calls.filter((c) => c === "enrichContact").length, 1);
  const settled = f.last.settleReveal as { creditsCharged: number; field: string; compliance?: boolean };
  assert.deepEqual([settled.creditsCharged, settled.field, settled.compliance], [1, "emails", undefined]);
  assert.equal(r.ok && r.outcome, "revealed");
});

test("a duplicate warning from the settle is returned to the caller", async () => {
  const f = fake({
    rows: WITH_SEARCH,
    settleReveal: async () => ({ outcome: "revealed", value: "x@example.invalid", written: "email", duplicate: { personId: "other", name: "Other Person" }, writeFailed: false }),
  });
  const r = await revealLushaField(input(), f.p);
  assert.deepEqual(r.ok && r.duplicate, { personId: "other", name: "Other Person" });
});

test("an already revealed value is served from the ledger with no network and no charge", async () => {
  const paid = row({ field: "emails", outcome: "revealed", value: "x@example.invalid" });
  const f = fake({ rows: { ...WITH_SEARCH, emails: paid } });
  const r = await revealLushaField(input(), f.p);
  assert.deepEqual([r.ok && r.value, r.ok && r.fromLedger, r.ok && r.writeFailed], ["x@example.invalid", true, false]);
  assert.deepEqual(spends(f.calls), []);
});

test("a paid value whose Contact write failed surfaces writeFailed for the caller to apply later", async () => {
  const paid = row({ field: "emails", outcome: "revealed", value: "x@example.invalid", payload: { emails: [], writeError: { code: "23505", message: "boom" } } });
  const r = await revealLushaField(input(), fake({ rows: { ...WITH_SEARCH, emails: paid } }).p);
  assert.deepEqual([r.ok && r.value, r.ok && r.writeFailed], ["x@example.invalid", true]);
  const live = fake({ rows: WITH_SEARCH, settleReveal: async () => ({ outcome: "revealed", value: "x@example.invalid", written: null, duplicate: null, writeFailed: true }) });
  const fresh = await revealLushaField(input(), live.p);
  assert.deepEqual([fresh.ok && fresh.value, fresh.ok && fresh.writeFailed, fresh.ok && fresh.written], ["x@example.invalid", true, null]);
});

test("an unreadable phone settles the real charge, writes nothing and says so (D17)", async () => {
  const seen: Array<number | null> = [];
  const f = fake({
    rows: WITH_SEARCH,
    enrichContact: async () => response(fixture("synthetic-wrong-shape-enrich-phones.json")),
    settleReveal: async (i) => {
      seen.push(i.creditsCharged);
      return { outcome: "no_value", value: null, written: null, duplicate: null, writeFailed: false };
    },
  });
  const r = await revealLushaField(input("phones"), f.p);
  assert.deepEqual([r.ok && r.outcome, r.ok && r.unreadable, r.ok && r.written], ["no_value", true, null]);
  assert.equal(seen.length, 1, "settled exactly once, with what Lusha billed (null = unknown, keeps the reservation counting)");
  assert.equal(f.calls.includes("failReservation"), false);
});

test("a reveal with no valid stored match, or past the cap, is refused before any reservation", async () => {
  const none = fake({ rows: {} });
  assert.equal((await revealLushaField(input(), none.p)).ok, false);
  const capped = fake({ rows: WITH_SEARCH, spent: 12 });
  const r = await revealLushaField(input(), capped.p);
  assert.deepEqual([r.ok, !r.ok && r.reason, !r.ok && r.remaining], [false, "lusha_cap_reached", 0]);
  assert.deepEqual(spends([...none.calls, ...capped.calls]), []);
});

test("a reservation refused as busy or over the cap makes no Lusha call", async () => {
  const busy = fake({ rows: WITH_SEARCH, reserve: async () => ({ ok: false, reason: "busy" }) });
  const r = await revealLushaField(input(), busy.p);
  assert.deepEqual([r.ok, !r.ok && r.reason, !r.ok && r.retryable], [false, "lusha_busy", true]);
  const over = fake({ rows: WITH_SEARCH, reserve: async () => ({ ok: false, reason: "cap_exceeded", remaining: 3 }) });
  const o = await revealLushaField(input(), over.p);
  assert.deepEqual([!o.ok && o.reason, !o.ok && o.remaining], ["lusha_cap_reached", 3]);
  assert.equal([...busy.calls, ...over.calls].some((c) => ACCOUNT_CALLS.includes(c)), false);
});

test("a match that changed between the read and the reservation is never revealed against the old id", async () => {
  const f = fake({ rows: WITH_SEARCH, reserve: async () => ({ ok: true, reservationId: "res-1", credits: 1, searchId: "s2-newer" }) });
  const r = await revealLushaField(input(), f.p);
  assert.equal(r.ok, false);
  assert.equal(f.calls.includes("enrichContact"), false);
  assert.deepEqual(f.last.failReservation, "res-1");
});

// --- errors: one call, no retry ------------------------------------------------------------

const FAILURES: Array<[string, LushaError, string, boolean]> = [
  ["429", new LushaError("rate_limited", "x", 429), "lusha_rate_limited", true],
  ["503", new LushaError("unavailable", "x", 503), "lusha_unavailable", true],
  ["could not connect (nothing sent)", new LushaError("unavailable", "Lusha could not be reached"), "lusha_unavailable", true],
  ["timeout after the send may have been billed", new LushaError("outcome_unknown", "Lusha request did not complete"), "lusha_outcome_unknown", false],
  ["402", new LushaError("no_credits", "x", 402), "lusha_no_credits", false],
  ["403", new LushaError("plan_denied", "x", 403), "lusha_plan_denied", false],
  ["401", new LushaError("bad_key", "x", 401), "lusha_unconfigured", false],
  ["400 reads as not retryable", new LushaError("unavailable", "x", 400), "lusha_unavailable", false],
  ["outcome_unknown", new LushaError("outcome_unknown", "x", 200), "lusha_outcome_unknown", false],
];

for (const [name, err, reason, retryable] of FAILURES) {
  test(`${name}: exactly one call, the reservation is failed with its kind, reason ${reason}, retryable ${retryable}`, async () => {
    const runs: Array<[LatestRows, (f: Fake) => Promise<{ ok: boolean }>]> = [
      [{}, (f) => searchLushaContact(input(), f.p)],
      [WITH_SEARCH, (f) => revealLushaField(input(), f.p)],
    ];
    for (const [rows, run] of runs) {
      const hit: string[] = [];
      const boom = async () => {
        hit.push("call");
        throw err;
      };
      const f = fake({ rows, searchContact: boom, enrichContact: boom });
      const r = (await run(f)) as Awaited<ReturnType<typeof revealLushaField>>;
      assert.deepEqual(hit, ["call"], "never retried");
      assert.deepEqual([r.ok, !r.ok && r.reason, !r.ok && r.retryable], [false, reason, retryable]);
      assert.equal(f.last.failReservation, "res-1");
      assert.equal(f.calls.filter((c) => c === "failReservation").length, 1);
      assert.equal(JSON.stringify(r).includes(KEY), false);
    }
  });
}

test("every Lusha error kind maps to one of the reasons, distinct where the BD must react differently", async () => {
  const { reasonForKind, LUSHA_REASONS } = await import("@/lib/lusha/reasons");
  for (const kind of LUSHA_ERROR_KINDS) assert.ok((LUSHA_REASONS as readonly string[]).includes(reasonForKind(kind)), kind);
  assert.notEqual(reasonForKind("no_credits"), reasonForKind("cap_exceeded"));
  assert.notEqual(reasonForKind("no_credits"), reasonForKind("compliance_blocked"));
  assert.equal(reasonForKind("compliance_blocked"), reasonForKind("compliance_restricted"));
  assert.equal(reasonForKind("outcome_unknown") === reasonForKind("unavailable"), false);
});

test("451 and COMPLIANCE_RESTRICTED settle as a permanent compliance outcome, never as a retryable failure", async () => {
  for (const enrich of [
    async () => {
      throw new LushaError("compliance_blocked", "x", 451);
    },
    async () => response(fixture("unverified-enrich-compliance-restricted.json")),
  ]) {
    const f = fake({ rows: WITH_SEARCH, enrichContact: enrich });
    const r = await revealLushaField(input(), f.p);
    assert.deepEqual([r.ok, !r.ok && r.reason, !r.ok && r.permanent, !r.ok && r.retryable], [false, "lusha_protected", true, false]);
    assert.equal((f.last.settleReveal as { compliance: boolean }).compliance, true);
    assert.equal(f.calls.includes("failReservation"), false);
  }
});

test("ENRICH_FAILED after a paid search fails only the reveal and a retry skips the search", async () => {
  const f = fake({ rows: WITH_SEARCH, enrichContact: async () => response(fixture("unverified-enrich-failed.json")) });
  const r = await revealLushaField(input(), f.p);
  assert.deepEqual([!r.ok && r.reason, !r.ok && r.retryable], ["lusha_enrich_failed", true]);
  assert.equal(f.calls.includes("settleSearch"), false);
  assert.equal(f.calls.includes("searchContact"), false);
  const again = fake({ rows: WITH_SEARCH });
  await revealLushaField(input(), again.p);
  assert.equal(again.calls.includes("searchContact"), false);
});

test("an async job response fails cleanly and releases the claim", async () => {
  const f = fake({ rows: WITH_SEARCH, enrichContact: async () => response(fixture("unverified-enrich-async-job.json")) });
  const r = await revealLushaField(input(), f.p);
  assert.deepEqual([!r.ok && r.reason, f.last.failReservation], ["lusha_async", "res-1"]);
});

test("an unexpected exception releases the claim and is rethrown for the action's catch", async () => {
  const f = fake({ rows: WITH_SEARCH, enrichContact: async () => { throw new TypeError("bug"); } });
  await assert.rejects(() => revealLushaField(input(), f.p), TypeError);
  assert.equal(f.last.failReservation, "res-1");
});

test("a settle that throws after the call fails the reservation so the spend stays counted", async () => {
  const g = fake({ settleSearch: async () => { throw new Error("db down"); } });
  await assert.rejects(() => searchLushaContact(input(), g.p), /db down/);
  assert.equal(g.last.failReservation, "res-1");
});

// --- reject and usage ----------------------------------------------------------------------

test("rejecting a match charges nothing and calls no Lusha endpoint; with no matched search it is refused", async () => {
  const f = fake();
  assert.deepEqual(await rejectLushaMatch({ personId: SUBJECT.id, actorBdId: "bd-1" }, f.p), { ok: true });
  assert.deepEqual(f.calls, ["assertEditable", "rejectMatch"]);
  const none = fake({ rejectMatch: async () => false });
  const r = await rejectLushaMatch({ personId: SUBJECT.id, actorBdId: "bd-1" }, none.p);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "lusha_not_eligible"]);
});

test("account usage is free and display-only: a failure is a soft result, a gate-off is refused without a call", async () => {
  const ok = await getLushaUsage(fake().p);
  assert.deepEqual(ok.ok && ok.usage, { total: 40, used: 2, remaining: null });
  const down = await getLushaUsage(fake({ getAccountUsage: async () => ({ ok: false }) }).p);
  assert.equal(down.ok, false);
  const off = fake({ config: { ok: false, reason: "not_production" } });
  assert.equal((await getLushaUsage(off.p)).ok, false);
  assert.equal(off.calls.includes("getAccountUsage"), false);
});

// --- review fixes: replay, held phone, failed settles ------------------------------------

test("a replayed reveal after outcome_unknown is refused server-side with no reservation and no call", async () => {
  const unknown = row({ id: "r2", field: "emails", state: "failed", errorCode: "outcome_unknown", searchId: "s1" });
  const f = fake({ rows: { ...WITH_SEARCH, emails: unknown } });
  const r = await revealLushaField(input(), f.p);
  assert.deepEqual([r.ok, !r.ok && r.reason, !r.ok && r.retryable], [false, "lusha_outcome_unknown", false]);
  assert.deepEqual(spends(f.calls), []);
  // Another failure kind is still a conscious retry.
  const other = fake({ rows: { ...WITH_SEARCH, emails: { ...unknown, errorCode: "unavailable" } } });
  assert.equal((await revealLushaField(input(), other.p)).ok, true);
});

test("after outcome_unknown the field can only be reopened by an explicit new (paid) search, never by serving the stored match", async () => {
  const unknown = row({ id: "r2", field: "emails", state: "failed", errorCode: "outcome_unknown", searchId: "s1" });
  const f = fake({ rows: { ...WITH_SEARCH, emails: unknown } });
  const r = await searchLushaContact(input(), f.p);
  assert.deepEqual([r.ok, r.ok && r.outcome === "matched" && r.reused], [true, false]);
  assert.deepEqual(spends(f.calls), ["reserve", "searchContact"]);
  // Without the unknown row the stored match is still served for free.
  const free = fake({ rows: WITH_SEARCH });
  assert.deepEqual(spends(free.calls), []);
  const served = await searchLushaContact(input(), free.p);
  assert.equal(served.ok && served.outcome === "matched" && served.reused, true);
  assert.deepEqual(spends(free.calls), []);
});

test("a reveal confirmed against another search or another price is refused before anything is reserved (two tabs, two BDs)", async () => {
  for (const expect of [{ searchId: "s-other", price: 1 }, { searchId: "s1", price: 5 }]) {
    const f = fake({ rows: WITH_SEARCH });
    const r = await revealLushaField({ ...input(), expect }, f.p);
    assert.deepEqual([r.ok, !r.ok && r.reason], [false, "lusha_stale"]);
    assert.deepEqual(spends(f.calls), []);
  }
});

test("a search never proceeds to a paid call for a field the UI deliberately offers no search for", async () => {
  const held = row({ id: "p1", field: "phones", outcome: "already_held", searchId: "s1" });
  const f = fake({ rows: { ...WITH_SEARCH, phones: held } });
  const r = await searchLushaContact(input("phones"), f.p);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "lusha_not_eligible"]);
  assert.deepEqual(spends(f.calls), []);
});

test("a paid value parked by a failed settle is never bought again", async () => {
  const parked = row({ id: "r2", field: "emails", state: "failed", errorCode: "settle_failed", searchId: "s1", payload: { emails: [{ email: "a@b.co" }] } });
  const f = fake({ rows: { ...WITH_SEARCH, emails: parked } });
  const r = await revealLushaField(input(), f.p);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "lusha_not_eligible"]);
  assert.deepEqual(spends(f.calls), []);
});

test("a matched search reports the id of the row that holds it, new or reused", async () => {
  const fresh = await searchLushaContact(input(), fake().p);
  assert.equal(fresh.ok && fresh.outcome === "matched" && fresh.searchId, "res-1");
  const reused = await searchLushaContact(input(), fake({ rows: WITH_SEARCH }).p);
  assert.equal(reused.ok && reused.outcome === "matched" && reused.searchId, "s1");
});

test("a phone Lusha returned that we already held is reported as already_held, not as a successful reveal", async () => {
  const f = fake({
    rows: WITH_SEARCH,
    settleReveal: async () => ({ outcome: "already_held", value: "+54 11 5555 5555", written: null, duplicate: null, writeFailed: false }),
  });
  const r = await revealLushaField(input("phones"), f.p);
  assert.deepEqual([r.ok && r.outcome, r.ok && r.written], ["already_held", null]);
});

test("a settle that throws after a paid reveal keeps the raw value and the billing on the ledger row, then rethrows", async () => {
  const saved: unknown[] = [];
  const f = fake({
    rows: WITH_SEARCH,
    settleReveal: async () => { throw new Error("db down"); },
    failReservation: async (id, code, payload) => { saved.push([id, code, payload]); return true; },
  });
  await assert.rejects(() => revealLushaField(input(), f.p), /db down/);
  const [id, code, payload] = saved[0] as [string, string, { emails: unknown[]; creditsCharged: number }];
  assert.deepEqual([id, code, payload.creditsCharged, Array.isArray(payload.emails) && payload.emails.length > 0], ["res-1", "settle_failed", 1, true]);
});

test("a throw while persisting a compliance block still releases the reservation", async () => {
  const failed: string[][] = [];
  const f = fake({
    rows: WITH_SEARCH,
    enrichContact: async () => { throw new LushaError("compliance_blocked", "x", 451); },
    settleReveal: async () => { throw new Error("db down"); },
    failReservation: async (id, code) => { failed.push([id, code]); return true; },
  });
  await assert.rejects(() => revealLushaField(input(), f.p), /db down/);
  assert.deepEqual(failed, [["res-1", "compliance_blocked"]]);
});

// --- stranded reservations ------------------------------------------------------------------------------------------------

test("a reveal over a stranded reservation is refused before any reserve or call: it may already have been billed", async () => {
  const { STRANDED_AFTER_MS } = await import("@/lib/lusha/revealState");
  const stranded = row({ id: "p1", field: "phones", state: "reserved", at: new Date(Date.now() - STRANDED_AFTER_MS - 60_000) });
  const f = fake({ rows: { search: MATCHED, phones: stranded } });
  const r = await revealLushaField(input("phones"), f.p);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "lusha_outcome_unknown"]);
  assert.deepEqual(spends(f.calls), []);
});

test("when reserve() itself reaped the row it refuses, and that maps to the outcome-unknown reason with no Lusha call", async () => {
  const f = fake({ rows: WITH_SEARCH, reserve: async () => ({ ok: false as const, reason: "outcome_unknown" as const }) });
  const r = await revealLushaField(input("phones"), f.p);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "lusha_outcome_unknown"]);
  assert.equal(f.calls.includes("enrichContact"), false);
});
