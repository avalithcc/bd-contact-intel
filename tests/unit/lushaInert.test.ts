import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// lusha-reveal PR 6 inverted this file (task 6.9). PRs 1-5 pinned "nothing a user can reach exists"; now the feature IS
// reachable, so the same scan pins the opposite, and still mechanical, facts:
//   1. the control is wired end to end (actions -> dialogs -> property row -> pane -> page);
//   2. exactly ONE client component can call the paid actions, exactly ONE file can reach the network client, and
//      nothing else in src reaches into the library at runtime except the page that resolves the control's state;
//   3. the API key is read in one place and never by client code; nothing registers a route, cron or vercel entry.
// A new importer of the library, of the actions or of the key fails here and must be added on purpose.

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const CONTACTS = "src/app/(app)/contacts/";
const ACTIONS = `${CONTACTS}lushaActions.ts`;
const REVEAL_UI = `${CONTACTS}[id]/LushaReveal.tsx`;
const ROW = `${CONTACTS}[id]/PropertyList.tsx`;
const PANE = `${CONTACTS}[id]/AboutPane.tsx`;
const PAGE = `${CONTACTS}[id]/page.tsx`;
// The contacts LIST reads the ledger once per page to warn before dialling a number Lusha flagged: a read only, no spend, no client.
const LIST = `${CONTACTS}page.tsx`;
const ADMIN = "src/app/(app)/admin/lusha/";
const ADMIN_PAGE = `${ADMIN}page.tsx`;
const ADMIN_ACTIONS = `${ADMIN}actions.ts`;
// lusha-reveals-drilldown: the "Revelados" card is a client component that only ever sees the library's TYPES.
const ADMIN_REVEALS_CARD = `${ADMIN}RevealsKpiCard.tsx`;
// lusha-cap-editor: the cap dialog is a client component too; it gets the credits-per-contact figure, the rail and today's spend as props.
const ADMIN_CAP_EDITOR = `${ADMIN}LushaCapEditor.tsx`;
const CAP_TEXT = "src/lib/credits/capText.ts"; // outside src/lib/lusha so the client may import it at runtime
const LIBRARY_DIR = "src/lib/lusha/";
const CONFIG = `${LIBRARY_DIR}config.ts`;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const rel = (p: string) => relative(ROOT, p);
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const allSrc = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f)).map(rel);
const outside = allSrc.filter((f) => !f.startsWith(LIBRARY_DIR));

/** Every `from "..."` / import() / require() path in a source text, with whether the import is type-only (erased at build). */
function imports(text: string): Array<{ path: string; typeOnly: boolean }> {
  const out = [...text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+["'`]([^"'`]+)["'`]/gm)].map((m) => ({ path: m[2], typeOnly: !!m[1] }));
  for (const m of text.matchAll(/(?:\bimport|\brequire)\(\s*["'`]([^"'`]+)["'`]\s*\)|^import\s+["'`]([^"'`]+)["'`]/gm)) out.push({ path: m[1] ?? m[2], typeOnly: false });
  return out;
}
const importers = (match: RegExp, files = outside, includeTypes = false) =>
  files.filter((f) => imports(read(f)).some((i) => match.test(i.path) && (includeTypes || !i.typeOnly))).sort();
const LIB = /(^|\/)lib\/lusha(\/|$)/;
const isClient = (f: string) => /^\s*["']use client["']/m.test(read(f));

test("the scan covers the whole of src, not just src/app", () => {
  assert.ok(outside.length > 100 && outside.some((f) => f.startsWith("src/components/")));
  assert.ok(allSrc.some((f) => f === ACTIONS) && allSrc.includes(REVEAL_UI));
});

test("the control is wired end to end: actions, dialogs, property row, pane, page", () => {
  const exported = [...read(ACTIONS).matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["applyStoredLushaValueAction", "getLushaAccountUsageAction", "rejectLushaMatchAction", "revealLushaFieldAction", "searchLushaContactAction"]);
  const ui = read(REVEAL_UI);
  for (const action of exported) assert.match(ui, new RegExp(`\\b${action}\\(`), `${action} is called by the dialogs`);
  assert.match(read(ROW), /<LushaRow\b/);
  assert.match(read(PANE), /lusha=\{lusha\}/);
  assert.match(read(PAGE), /buildLushaView\(/);
  assert.match(read(PAGE), /lusha=\{lusha\}/);
});

test("only the Lusha dialogs import the server actions, and only the property row renders them", () => {
  assert.deepEqual(importers(/lushaActions$/, outside, true), [REVEAL_UI]);
  assert.deepEqual(importers(/LushaReveal$/, outside, true), [ROW]);
  assert.ok(isClient(REVEAL_UI), "the actions are called from a client component, so the import is a server-action reference");
});

test("only the actions file can reach the network client or the real ports", () => {
  assert.deepEqual(importers(/lib\/lusha\/(client|ports)$/, outside, true), [ACTIONS]);
});

test("outside the library, only the actions, the record page, the list (a read-only flag lookup) and the admin switch import it at runtime", () => {
  // lusha-per-bd: the admin page reads the report and the day's spend; its action flips the switch. Neither can spend a credit
  // (no client, no ports, no reserve): the "network client or real ports" test above still pins that.
  assert.deepEqual(importers(LIB), [ACTIONS, PAGE, LIST, ADMIN_PAGE, ADMIN_ACTIONS].sort());
  // Client code may only use the library's TYPES; a runtime import would ship ledger or client code to the browser.
  const clientRuntime = importers(LIB, outside.filter(isClient));
  assert.deepEqual(clientRuntime, []);
  // Type-only importers: the dialogs and the two components that pass the view down.
  assert.deepEqual(importers(LIB, outside, true).filter((f) => !importers(LIB).includes(f)), [PANE, ROW, REVEAL_UI, ADMIN_REVEALS_CARD].sort());
});

test("the cap editor ships no library code to the browser: nothing from src/lib/lusha at runtime, in it or in the helper it shares with the table", () => {
  assert.ok(isClient(ADMIN_CAP_EDITOR));
  for (const f of [ADMIN_CAP_EDITOR, CAP_TEXT]) {
    assert.deepEqual(imports(read(f)).filter((i) => LIB.test(i.path) && !i.typeOnly), [], f);
  }
  assert.ok(imports(read(ADMIN_CAP_EDITOR)).some((i) => i.path === "@/lib/credits/capText"), "the live contacts text comes from the shared helper");
});

test("the API key is read in one place, by server code, and is never public", () => {
  const readers = allSrc.filter((f) => /env\.LUSHA_API_KEY|env\[\s*["'`]LUSHA_API_KEY["'`]\s*\]|NEXT_PUBLIC_LUSHA/.test(read(f)));
  assert.deepEqual(readers, []);
  assert.match(read(CONFIG), /API_KEY_VAR = "LUSHA_API_KEY"/);
  assert.deepEqual(allSrc.filter((f) => /API_KEY_VAR/.test(read(f)) && f !== CONFIG), []);
  assert.deepEqual(importers(/lusha\/config$/, outside.filter(isClient), true), []);
});

test("the Lusha fetch always times out before the function that hosts the actions is killed", () => {
  const timeout = Number(/TIMEOUT_MS = ([\d_]+)/.exec(read(`${LIBRARY_DIR}client.ts`))?.[1].replace(/_/g, ""));
  const maxDuration = Number(/export const maxDuration = (\d+)/.exec(read(PAGE))?.[1]);
  assert.ok(timeout > 0 && maxDuration >= 30 && timeout * 2 <= maxDuration * 1000, `${timeout} ms vs ${maxDuration} s`);
});

test("nothing registers Lusha as a route, a page or a cron", () => {
  const appFiles = walk(join(SRC, "app")).map(rel);
  // The one deliberate exception: the admin switch/report page (lusha-per-bd), which can spend nothing.
  assert.deepEqual(appFiles.filter((f) => /(^|\/)(page\.tsx|route\.ts)$/.test(f) && /lusha/i.test(f)), [ADMIN_PAGE]);
  assert.deepEqual(appFiles.filter((f) => /(^|\/)route\.ts$/.test(f) && /lusha/i.test(read(f))), []);
  assert.doesNotMatch(readFileSync(join(ROOT, "vercel.json"), "utf8"), /lusha/i);
});

test("the dialogs use only design-system classes, no inline style and no colour literal (spec: no new design tokens)", () => {
  const css = ["src/app/design-system.css", "src/app/globals.css"].map(read).join("\n");
  const ui = read(REVEAL_UI);
  const classAttr = [...ui.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, " "));
  const literals = [...ui.matchAll(/"((?:btn|alert|badge)[\w -]*)"/g)].map((m) => m[1]);
  const tokens = new Set([...classAttr, ...literals].flatMap((v) => v.split(/\s+/)).filter(Boolean));
  assert.ok(tokens.size > 15 && tokens.has("locked") && tokens.has("alert-danger") && tokens.has("btn-ghost"));
  assert.deepEqual([...tokens].filter((t) => !new RegExp(`\\.${t}(?![\\w-])`).test(css)), []);
  assert.doesNotMatch(ui, /\bstyle=|#[0-9a-fA-F]{3,8}\b/);
});

test("the import and key scanners recognise every form they claim to", () => {
  const text = 'import type { A } from "@/lib/lusha/revealView";\nimport { b } from "@/lib/lusha/cap";\nconst m = await import("@/lib/lusha/x");\nimport "@/lib/lusha/side";\nimport {\n  c,\n} from "../lushaActions";';
  assert.deepEqual(imports(text).map((i) => [i.path, i.typeOnly]), [["@/lib/lusha/revealView", true], ["@/lib/lusha/cap", false], ["../lushaActions", false], ["@/lib/lusha/x", false], ["@/lib/lusha/side", false]]);
  assert.ok(LIB.test("@/lib/lusha/cap") && LIB.test("@/lib/lusha") && !LIB.test("@/lib/lushaless/x"));
});
