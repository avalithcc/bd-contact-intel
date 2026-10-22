/**
 * lusha-per-bd: the admin page and its action are reachable by admins only, decided on the server. A BD cannot enable themselves by
 * calling the action directly, and the admin page 404s for anyone else. Source-level pins (the behaviour of setLushaEnabled itself,
 * including the role check, is in tests/db/lushaPerBd.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const ACTIONS = read("src/app/(app)/admin/lusha/actions.ts");
const PAGE = read("src/app/(app)/admin/lusha/page.tsx");
const DB = read("src/lib/lusha/adminDb.ts");

test("the action authenticates as an admin before it validates anything or writes", () => {
  const body = ACTIONS.slice(ACTIONS.indexOf("export async function setLushaEnabledAction"));
  assert.ok(body.indexOf("await requireAdmin()") > 0);
  assert.ok(body.indexOf("await requireAdmin()") < body.indexOf("isUuid("));
  assert.ok(body.indexOf("await requireAdmin()") < body.indexOf("await setLushaEnabled("));
  assert.match(ACTIONS, /^"use server";/);
  assert.deepEqual([...ACTIONS.matchAll(/export async function (\w+)/g)].map((m) => m[1]), ["setLushaEnabledAction", "getRevealsDrilldownAction"]);
});

test("the reveals drill-down action is admin-gated first and takes a period name, never a caller-supplied range", () => {
  const body = ACTIONS.slice(ACTIONS.indexOf("export async function getRevealsDrilldownAction"));
  assert.ok(body.indexOf("await requireAdmin()") > 0 && body.indexOf("await requireAdmin()") < body.indexOf("getRevealsDrilldown("));
  assert.match(body, /getRevealsDrilldownAction\(period: string\)/);
  assert.match(body, /catch \(err\) \{\s*unstable_rethrow\(err\);/);
});

test("the page is admin-gated and 404s for a BD, before it reads anything", () => {
  assert.ok(PAGE.indexOf("await requireAdmin()") > 0 && PAGE.indexOf("await requireAdmin()") < PAGE.indexOf("getLushaUsageReport("));
  assert.match(PAGE, /AdminRequiredError\) notFound\(\)/);
});

test("the write itself asserts the admin role again, so no caller reaches it unchecked", () => {
  const fn = DB.slice(DB.indexOf("export async function setLushaEnabled"));
  assert.ok(fn.indexOf("assertAdminRole(input.actor)") > 0 && fn.indexOf("assertAdminRole(") < fn.indexOf("db.transaction"));
});

test("the toggle and its audit row are one transaction, and the UI cannot be the only control", () => {
  const fn = DB.slice(DB.indexOf("export async function setLushaEnabled"));
  const tx = fn.slice(fn.indexOf("db.transaction"));
  assert.ok(tx.includes("tx.update(bd)") && tx.includes("tx.insert(auditLog)"));
  const reveal = read("src/lib/lusha/reveal.ts");
  const revealDb = read("src/lib/lusha/revealDb.ts");
  assert.match(reveal, /isLushaEnabled\(actorBdId\)/);
  // Inside reserve(), after the cap's advisory lock and before any row is written.
  const reserve = revealDb.slice(revealDb.indexOf("export async function reserve("));
  assert.ok(reserve.indexOf("pg_advisory_xact_lock") < reserve.indexOf("isLushaEnabled(") && reserve.indexOf("isLushaEnabled(") < reserve.indexOf(".insert(lushaReveal)"));
});
