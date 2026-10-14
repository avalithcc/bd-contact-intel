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

test("the day's sum counts coalesce(credits_charged, credits_reserved), never a plain sum(credits_charged)", () => {
  assert.match(code, /sum\(coalesce\(\$\{lushaReveal\.creditsCharged\}, \$\{lushaReveal\.creditsReserved\}\)\)/);
  assert.doesNotMatch(code, /sum\(\$\{lushaReveal\.creditsCharged\}\)/);
  assert.match(code, /Number\(row\?\.spent\)/);
});

test("reserve takes the advisory lock before it reads the spend, and claims on the in-flight partial index", () => {
  const reserveBody = code.slice(code.indexOf("export async function reserve"), code.indexOf("const inFlight"));
  assert.ok(reserveBody.indexOf("pg_advisory_xact_lock") >= 0);
  assert.ok(reserveBody.indexOf("pg_advisory_xact_lock") < reserveBody.indexOf("getDailySpend("));
  assert.match(reserveBody, /onConflictDoNothing\(\{ target: \[lushaReveal\.personId, lushaReveal\.field\], where: sql`state = 'reserved'`/);
});

test("the settle inserts the activity directly and never uses the manual edit path", () => {
  assert.doesNotMatch(code, /createActivityInTx|updateContactProperty|planPropertyEdit/);
  assert.match(code, /insert\(activity\)/);
});
