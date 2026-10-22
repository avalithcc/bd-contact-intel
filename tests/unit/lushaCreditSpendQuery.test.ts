process.env.DATABASE_URL ??= "postgres://unit:unit@127.0.0.1:1/unit";

/**
 * The credit-spend read answers four numbers in ONE statement: the team's day, the billing cycle, the ACTING BD's own day and that BD's
 * personal cap. "Today" and "a credit spent" must each have exactly one definition, or the three caps stop agreeing: the actor's daily
 * sum has to be the team's daily sum plus one predicate on the actor, never a second copy of the window or of the credits expression.
 *
 * The query is COMPILED with PgDialect and never executed (no database). Every expectation is derived from the SQL it compiles to.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();
const NOW = new Date("2026-10-22T15:30:00.000Z");
const ACTOR = "11111111-2222-4333-8444-555555555555";
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

async function compiled(actor: string | null = ACTOR) {
  const { creditSpendQuery } = await import("@/lib/lusha/revealDb");
  const { artDayWindow, lushaCycleWindow } = await import("@/lib/lusha/cap");
  const q = dialect.sqlToQuery(creditSpendQuery(NOW, 21, actor));
  // Inline each $n with the parameter it is bound to, so predicates compare by meaning and not by placeholder number.
  const inline = (text: string) => text.replace(/\$(\d+)/g, (_, n: string) => `<${String(q.params[Number(n) - 1])}>`);
  const sql = inline(norm(q.sql));
  const select = sql.match(/^ ?select (coalesce.*?) as spent_today, (coalesce.*?) as spent_cycle, (coalesce.*?) as spent_actor_today, /);
  assert.ok(select, "the three sums are the first three columns of the statement");
  const sums = { spent_today: select[1], spent_cycle: select[2], spent_actor_today: select[3] };
  const aggregate = (alias: string) => sums[alias as keyof typeof sums];
  return { q, sql, aggregate, day: artDayWindow(NOW), cycle: lushaCycleWindow(NOW, 21) };
}

test("the team's day sum and the actor's day sum count the same credits: coalesce(credits_charged, credits_reserved)", async () => {
  const { aggregate } = await compiled();
  const sums = ["spent_today", "spent_cycle", "spent_actor_today"].map((a) => aggregate(a)?.match(/sum\((.*?)\)(?: filter|, 0\))/)?.[1]);
  assert.deepEqual(sums, ["coalesce(credits_charged, credits_reserved)", "coalesce(credits_charged, credits_reserved)", "coalesce(credits_charged, credits_reserved)"]);
});

test("the actor's day sum is the team's day sum plus ONE predicate on the actor: same window, same instants", async () => {
  const { aggregate, day } = await compiled();
  const team = aggregate("spent_today")?.match(/filter \(where (.*)\), 0\)$/)?.[1];
  const actor = aggregate("spent_actor_today")?.match(/filter \(where (.*)\), 0\)$/)?.[1];
  assert.ok(team && actor, "both day sums are FILTERed");
  assert.equal(team, `at >= <${day.start.toISOString()}>::timestamptz and at < <${day.end.toISOString()}>::timestamptz`);
  assert.equal(actor, `${team} and actor_bd_id = <${ACTOR}>::uuid`);
});

test("everything is one statement over one scan of the cycle's rows, and the personal cap is read in that same statement", async () => {
  const { sql, cycle } = await compiled();
  assert.equal(sql.match(/\bfrom lusha_reveal\b/g)?.length, 1);
  assert.match(sql, new RegExp(`\\(select b\\.lusha_personal_daily_credit_cap from bd b where b\\.id = <${ACTOR}>::uuid\\) as personal_cap`));
  assert.ok(sql.endsWith(`where at >= <${cycle.start.toISOString()}>::timestamptz and at < <${cycle.end.toISOString()}>::timestamptz`));
});

test("no actor (the admin page) binds a null actor: the actor's spend is 0 and there is no personal cap, never an error", async () => {
  const { q } = await compiled(null);
  assert.ok(q.params.includes(null));
});

test("the row mapper turns postgres-js strings into numbers and keeps NULL as 'no personal cap'", async () => {
  const { mapCreditSpend } = await import("@/lib/lusha/revealDb");
  assert.deepEqual(mapCreditSpend({ spent_today: "3", spent_cycle: "20", spent_actor_today: "2", personal_cap: 12 }), { today: 3, cycle: 20, actorToday: 2, personalCap: 12 });
  assert.deepEqual(mapCreditSpend({ spent_today: 3, spent_cycle: 20, spent_actor_today: 0, personal_cap: null }), { today: 3, cycle: 20, actorToday: 0, personalCap: null });
  assert.equal(mapCreditSpend({ spent_today: 3, spent_cycle: 20, spent_actor_today: 0, personal_cap: "0" }).personalCap, 0, "0 is a cap, not an absence");
  assert.ok(Number.isNaN(mapCreditSpend({ spent_today: 3, spent_cycle: 20, spent_actor_today: 0, personal_cap: "abc" }).personalCap), "unreadable stays unreadable so the cap fails closed");
  assert.ok(Number.isNaN(mapCreditSpend(undefined).today), "no row at all is refused downstream, not read as zero spend");
});
