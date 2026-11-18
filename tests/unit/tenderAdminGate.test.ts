/**
 * Tenders are a business decision, not BD work: the section and its digest are admin-only (owner, 2026-11-18). The gate lives
 * on every entry point on the server; hiding the nav link is not a permission. Source-level pins, the repo's convention for
 * gates (see lushaAdminGate.test.ts): the actions import the DB, so they cannot run in a unit test.
 *
 * The enumeration is deliberate: the list of exported server actions is read from the file, so an action added later without
 * the gate fails here by name instead of passing unnoticed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { NAVIGATION } from "@/app/contacts/Sidebar";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const ACTIONS = read("src/app/(app)/licitaciones/actions.ts");

const EXPECTED_ACTIONS = [
  "importTendersAction",
  "setTenderTriageAction",
  "setTenderRelevanceAction",
  "setTenderOwnerAction",
  "saveTenderNoteAction",
  "registerTenderDocumentAction",
  "analyseTenderAction",
];

/** The body of one exported function: from its signature to the next top-level export (or the end of the file). */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

/** The first statement after the signature line. */
const firstStatement = (body: string): string => body.slice(body.indexOf("{\n") + 2).split("\n").find((l) => l.trim() !== "" && !l.trim().startsWith("//"))!.trim();

test("the enumeration is complete: every exported server action is a known one", () => {
  const found = [...ACTIONS.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...found].sort(), [...EXPECTED_ACTIONS].sort(), "a new action must be added here AND gated");
  assert.match(ACTIONS, /^"use server";/);
});

for (const name of EXPECTED_ACTIONS) {
  test(`${name} refuses a non-admin before it reads or writes anything`, () => {
    const body = bodyOf(ACTIONS, name);
    assert.match(firstStatement(body), /^const me = await requireAdmin\(\);$/, `${name} must open with requireAdmin()`);
    assert.doesNotMatch(body, /getCurrentBd\(/, `${name} must not fall back to the session-only check`);
  });
}

test("the list page and the ficha 404 for a non-admin before they read a tender", () => {
  const list = read("src/app/(app)/licitaciones/page.tsx");
  const ficha = read("src/app/(app)/licitaciones/[id]/page.tsx");
  assert.ok(list.indexOf("await requireAdmin()") > 0 && list.indexOf("await requireAdmin()") < list.indexOf("listTenders("));
  assert.ok(ficha.indexOf("await requireAdmin()") > 0 && ficha.indexOf("await requireAdmin()") < ficha.indexOf("getTenderDetail("));
  for (const src of [list, ficha]) assert.match(src, /AdminRequiredError\) notFound\(\)/);
});

test("the document route refuses a non-admin before it looks the document up", () => {
  const route = read("src/app/(app)/licitaciones/[id]/documento/route.ts");
  const gate = route.indexOf("requireAdmin()");
  assert.ok(gate > 0 && gate < route.indexOf("getCurrentTenderDocument("));
  assert.match(route, /AdminRequiredError/);
});

test("the Excel import is an action behind the same gate, and importTenderFile is only reached through it", () => {
  assert.match(firstStatement(bodyOf(ACTIONS, "importTendersAction")), /requireAdmin/);
  const callers = ["src/app/(app)/licitaciones/page.tsx", "src/app/(app)/licitaciones/TenderImportForm.tsx"].map(read).join("\n");
  assert.doesNotMatch(callers, /importTenderFile\(/);
});

test("the nav entry is in ADMINISTRACIÓN and not in a section every BD sees", () => {
  const hrefs = NAVIGATION.flatMap((s) => s.items.map((i) => i.href));
  assert.ok(!hrefs.includes("/licitaciones"), "NAVIGATION is rendered for everyone");
  const sidebar = read("src/app/contacts/Sidebar.tsx");
  const adminBlock = sidebar.slice(sidebar.indexOf("{isAdmin && ("));
  assert.ok(adminBlock.includes('href="/licitaciones"'), "the admin block holds the link");
  assert.ok(!sidebar.slice(0, sidebar.indexOf("{isAdmin && (")).includes('href="/licitaciones"'));
});

test("the owner picker offers admins only, and a non-admin cannot be assigned at the write", () => {
  const ws = read("src/lib/tenders/workspace.ts");
  assert.match(ws.slice(ws.indexOf("const bdOptionsJson")), /from bd b where b\.role = 'admin'/);
  const setOwner = ws.slice(ws.indexOf("export async function setTenderOwner"));
  assert.match(setOwner, /who as \(select name from bd where id = \$\{ownerBdId\}::uuid and role = 'admin'\)/);
});
