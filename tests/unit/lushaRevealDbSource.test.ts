import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// revealDb imports @/db (needs DATABASE_URL), so its structural rules are asserted on the source;
// its behaviour is covered by tests/db/lushaReveal.test.ts.
const src = readFileSync("src/lib/lusha/revealDb.ts", "utf8");
const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");

test("revealDb never imports the HTTP client: the call is structurally outside the lock", () => {
  assert.doesNotMatch(code, /from ["']\.\/client["']/);
  assert.doesNotMatch(code, /fetch\(|enrichContact|searchContact/);
});

test("the cap is read from the ledger only, never from /v3/account/usage", () => {
  assert.doesNotMatch(code, /account\/usage|getAccountUsage|usage/i);
});

// The spend read is a builder (creditSpendQuery) plus the thin reader around it; the compiled SQL is pinned by lushaCreditSpendQuery.test.ts.
const spendBody = () => code.slice(code.indexOf("const CREDITS = sql.raw"), code.indexOf("export type ReserveResult"));

test("the spend sums count coalesce(credits_charged, credits_reserved), never a plain sum(credits_charged), and say it exactly once", () => {
  const body = spendBody();
  assert.equal(body.match(/coalesce\(credits_charged, credits_reserved\)/g)?.length, 1, "one definition of a credit spent, shared by every sum");
  assert.equal(body.match(/sum\(\$\{CREDITS\}\)/g)?.length, 3, "the team's day, the cycle and the actor's day");
  assert.doesNotMatch(body, /sum\(credits_charged\)/);
  assert.match(body, /Number\(row\?\.spent_today\)/);
  assert.match(body, /Number\(row\?\.spent_cycle\)/);
  assert.match(body, /Number\(row\?\.spent_actor_today\)/);
});

test("the spend comes from ONE statement (one round trip), with ISO-cast parameters, never a JS Date", () => {
  const body = spendBody();
  assert.equal(body.match(/\.execute\(/g)?.length, 1);
  assert.doesNotMatch(body, /\$\{(day|cycle|w)\.(start|end)\}/, "a Date in a raw sql template is rejected by postgres-js");
  assert.equal(body.match(/\.toISOString\(\)\}::timestamptz/g)?.length, 2, "the window predicate is written once and reused for the day and the cycle");
});

test("reserve takes the advisory lock before it reads the spend, and claims on the in-flight partial index", () => {
  const reserveBody = code.slice(code.indexOf("export async function reserve"), code.indexOf("const inFlight"));
  assert.ok(reserveBody.indexOf("pg_advisory_xact_lock") >= 0);
  assert.ok(reserveBody.indexOf("pg_advisory_xact_lock") < reserveBody.indexOf("getCreditSpend("));
  assert.match(reserveBody, /onConflictDoNothing\(\{ target: \[lushaReveal\.personId, lushaReveal\.field\], where: sql`state = 'reserved'`/);
});

test("reserve reads the spend INSIDE the lock: the transaction handle and the acting BD are passed to getCreditSpend", () => {
  const body = code.slice(code.indexOf("export async function reserve"), code.indexOf("const inFlight"));
  // `reader` and `actorBdId` are adjacent positional parameters and tsc cannot tell a dropped `tx` from a deliberate default:
  // without `tx` the read leaves the advisory-locked transaction and two reservations can both pass the cap.
  assert.match(body, /getCreditSpend\(now, input\.limits\.cycleStartDay, tx, input\.actorBdId\)/);
});

test("reserve share-locks the person row and checks for an already revealed value inside the lock", () => {
  const body = code.slice(code.indexOf("export async function reserve"), code.indexOf("const inFlight"));
  assert.match(body, /\.for\("share"\)/);
  assert.match(body, /r\.outcome = 'revealed'/);
  assert.doesNotMatch(body.slice(body.indexOf("r.outcome = 'revealed'") - 200, body.indexOf("r.outcome = 'revealed'") + 60), /search_id/, "ownership is regardless of search_id");
});

test("the settle inserts the activity directly and never uses the manual edit path", () => {
  assert.doesNotMatch(code, /createActivityInTx|updateContactProperty|planPropertyEdit/);
  assert.match(code, /insert\(activity\)/);
});

test("reserve reaps stranded rows under the lock and before the spend is read; the reaper fails the row and never frees credits", () => {
  const body = code.slice(code.indexOf("export async function reserve"), code.indexOf("const inFlight"));
  const [lock, reap, spend] = [body.indexOf("pg_advisory_xact_lock"), body.indexOf("error_code = 'reaped'"), body.indexOf("getCreditSpend(")];
  assert.ok(lock >= 0 && lock < reap && reap < spend);
  const stmt = body.slice(reap - 80, reap + 260);
  assert.match(stmt, /state = 'failed'/);
  assert.doesNotMatch(stmt, /credits_reserved|credits_charged/, "the reserved amount is left exactly as it was");
});
