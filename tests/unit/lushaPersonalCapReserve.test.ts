process.env.DATABASE_URL ??= "postgres://unit:unit@127.0.0.1:1/unit";

/**
 * reserve() enforces the personal cap with the ACTOR's own spend and the ACTOR's own cap, both read inside its one transaction.
 * No database: the transaction is a scripted fake whose spend statement answers what Postgres would have answered, so these assert the
 * DECISION reserve makes from the figures it reads, and that it reads them from the statement it runs under the lock.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { searchLushaContact, type RevealPorts } from "@/lib/lusha/reveal";

const dialect = new PgDialect();
const ACTOR = "11111111-2222-4333-8444-555555555555";
const LIMITS = { dailyCap: 60, monthlyCap: 400, cycleStartDay: 21 };
const NOW = new Date("2026-10-22T15:30:00.000Z");

type Spend = { spent_today: string; spent_cycle: string; spent_actor_today: string; personal_cap: number | null };

/** A transaction that records every statement and answers the spend statement with `spend`. */
function scriptedDb(spend: Spend) {
  const statements: { text: string; params: unknown[] }[] = [];
  const inserted: Record<string, unknown>[] = [];
  const tx = {
    execute: async (q: SQL) => {
      const c = dialect.sqlToQuery(q);
      statements.push({ text: c.sql.replace(/\s+/g, " "), params: c.params });
      return c.sql.includes("spent_actor_today") ? [spend] : [];
    },
    select: (fields: Record<string, unknown>) => {
      const rows = "on" in fields ? [{ on: true }] : [{ mergedIntoId: null, unknown: false, owned: false }];
      const chain: Record<string, unknown> = { then: (ok: (r: unknown) => unknown) => Promise.resolve(rows).then(ok) };
      for (const m of ["from", "where", "for", "orderBy", "limit"]) chain[m] = () => chain;
      return chain;
    },
    insert: () => ({ values: (v: Record<string, unknown>) => (inserted.push(v), { onConflictDoNothing: () => ({ returning: async () => [{ id: "res-1" }] }) }) }),
  };
  return { database: { transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } as never, statements, inserted };
}

const reserveSearch = async (spend: Spend) => {
  const { reserve } = await import("@/lib/lusha/revealDb");
  const db = scriptedDb(spend);
  const result = await reserve({ personId: "p1", field: "search", actorBdId: ACTOR, limits: LIMITS, now: NOW }, db.database);
  return { result, ...db };
};

test("the team is well under every cap but the actor is over hers: reserve refuses by the personal cap and writes nothing", async () => {
  const { result, inserted } = await reserveSearch({ spent_today: "12", spent_cycle: "80", spent_actor_today: "12", personal_cap: 12 });
  assert.deepEqual(result, { ok: false, reason: "cap_exceeded", cap: "personal", remaining: 0 });
  assert.deepEqual(inserted, []);
});

test("the actor's figures decide, not the team's: the actor under her cap passes while the team has spent far more than 12", async () => {
  const { result, inserted } = await reserveSearch({ spent_today: "40", spent_cycle: "200", spent_actor_today: "3", personal_cap: 12 });
  assert.equal(result.ok, true);
  assert.equal(inserted.length, 1);
});

test("a BD with no personal cap is reserved exactly as before, however much she spent today", async () => {
  const { result } = await reserveSearch({ spent_today: "40", spent_cycle: "200", spent_actor_today: "500", personal_cap: null });
  assert.equal(result.ok, true);
});

test("an explicit personal cap of 0 refuses even a first step", async () => {
  const { result } = await reserveSearch({ spent_today: "0", spent_cycle: "0", spent_actor_today: "0", personal_cap: 0 });
  assert.deepEqual(result, { ok: false, reason: "cap_exceeded", cap: "personal", remaining: 0 });
});

test("an unreadable cap from the database fails closed instead of reading as 'no cap'", async () => {
  const { result } = await reserveSearch({ spent_today: "0", spent_cycle: "0", spent_actor_today: "0", personal_cap: "garbage" as never });
  assert.equal(result.ok, false);
});

test("the monthly cap still outranks the personal one inside reserve", async () => {
  const { result } = await reserveSearch({ spent_today: "0", spent_cycle: "400", spent_actor_today: "12", personal_cap: 12 });
  assert.deepEqual(result, { ok: false, reason: "cap_exceeded", cap: "monthly", remaining: 0 });
});

test("the actor's day and cap are read by ONE statement run under the lock, bound to the acting BD, never passed in", async () => {
  const { statements } = await reserveSearch({ spent_today: "0", spent_cycle: "0", spent_actor_today: "0", personal_cap: 12 });
  const lock = statements.findIndex((s) => s.text.includes("pg_advisory_xact_lock"));
  const spend = statements.findIndex((s) => s.text.includes("spent_actor_today"));
  assert.ok(lock >= 0 && spend > lock, "the spend is read after the lock is taken");
  assert.equal(statements.filter((s) => s.text.includes("lusha_personal_daily_credit_cap")).length, 1, "the cap is read in the same statement as the sums, no extra round trip");
  assert.ok(statements[spend]!.params.includes(ACTOR));
});

// --- the orchestration reads the same figures ---------------------------------------------------------------------------------------

test("the pre-check asks for the acting BD's spend and refuses by the personal cap before any reservation or Lusha call", async () => {
  const asked: string[] = [];
  const calls: string[] = [];
  const p = {
    config: { ok: true, config: { apiKey: "k" } },
    limits: LIMITS,
    isLushaEnabled: async () => true,
    assertEditable: async () => undefined,
    loadSubject: async () => ({ id: "p1", firstName: "Ana", lastName: "Example", email: null, emailStatus: "none", emailSource: null, phone: null, mobilePhone: null, mergedIntoId: null, linkedinUrl: null, companyDomain: "example.com" }),
    getRevealState: async () => ({}),
    getSpend: async (actor: string) => (asked.push(actor), { today: 12, cycle: 80, actorToday: 12, personalCap: 12 }),
    reserve: async () => (calls.push("reserve"), { ok: true, reservationId: "r", credits: 1, searchId: null }),
    searchContact: async () => (calls.push("searchContact"), {}),
  } as unknown as RevealPorts;
  const r = await searchLushaContact({ personId: "p1", field: "emails", actorBdId: ACTOR }, p);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "lusha_personal_cap_reached"]);
  assert.deepEqual(asked, [ACTOR]);
  assert.deepEqual(calls, []);
});

test("the live port forwards the acting BD to the spend read, so the pre-check and reserve see the same personal figures", async () => {
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync("src/lib/lusha/ports.ts", "utf8"), /getSpend: \(actorBdId\) => getCreditSpend\(new Date\(\), limits\.cycleStartDay, undefined, actorBdId\)/);
});
