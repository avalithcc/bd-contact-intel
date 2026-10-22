process.env.DATABASE_URL ??= "postgres://unit:unit@127.0.0.1:1/unit";

/**
 * lusha-cap-editor: an admin edits one BD's personal Lusha cap from /admin/lusha, and the change is audited.
 * Pure and source-level pins (the transaction itself runs in tests/db/lushaCapEditor.test.ts, against the scratch database).
 * The semantics that must survive every layer: null = no personal cap, 0 = blocked. They are different values.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { CREDITS_PER_CONTACT, MAX_PERSONAL_DAILY_CAP, artDayWindow, parsePersonalDailyCap } from "../../src/lib/lusha/cap";
import { mapUsageRow, personalCapLines, type RawUsageRow } from "../../src/lib/lusha/usageReport";
import { capContactsText, capSaveIntent, readCapField } from "../../src/lib/credits/capText";
import { en } from "../../src/lib/i18n/dictionaries/en";
import { es } from "../../src/lib/i18n/dictionaries/es";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const ACTIONS = read("src/app/(app)/admin/lusha/actions.ts");
const DB = read("src/lib/lusha/adminDb.ts");
const EDITOR = read("src/app/(app)/admin/lusha/LushaCapEditor.tsx");
const PAGE = read("src/app/(app)/admin/lusha/page.tsx");
const dialect = new PgDialect();
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

test("validation fails closed: only null or an integer from 0 to the maximum passes, and 0 stays 0", () => {
  assert.deepEqual(parsePersonalDailyCap(null), { ok: true, cap: null });
  assert.deepEqual(parsePersonalDailyCap(0), { ok: true, cap: 0 });
  assert.deepEqual(parsePersonalDailyCap(-0), { ok: true, cap: 0 });
  assert.deepEqual(parsePersonalDailyCap(8), { ok: true, cap: 8 });
  assert.deepEqual(parsePersonalDailyCap(MAX_PERSONAL_DAILY_CAP), { ok: true, cap: MAX_PERSONAL_DAILY_CAP });
  assert.equal(MAX_PERSONAL_DAILY_CAP, 999);
  for (const bad of [1000, -1, 1.5, Number.NaN, Infinity, -Infinity, "8", "", "0", undefined, {}, [], true, false, 1e21]) {
    assert.deepEqual(parsePersonalDailyCap(bad), { ok: false }, String(bad));
  }
});

test("the action is admin-gated first, then validates, then writes", () => {
  const body = ACTIONS.slice(ACTIONS.indexOf("export async function setLushaPersonalCapAction"));
  const gate = body.indexOf("await requireAdmin()");
  assert.ok(gate > 0);
  assert.ok(gate < body.indexOf("isUuid("));
  assert.ok(gate < body.indexOf("parsePersonalDailyCap("));
  assert.ok(body.indexOf("parsePersonalDailyCap(") < body.indexOf("await setLushaPersonalCap("));
  assert.match(body, /revalidatePath\("\/admin\/lusha"\)/);
});

test("the write asserts the admin role itself, validates again, and the change and its audit row share one transaction", () => {
  const fn = DB.slice(DB.indexOf("export async function setLushaPersonalCap"));
  assert.ok(fn.indexOf("assertAdminRole(input.actor)") > 0 && fn.indexOf("assertAdminRole(") < fn.indexOf("db.transaction"));
  assert.ok(fn.indexOf("parsePersonalDailyCap(") > 0 && fn.indexOf("parsePersonalDailyCap(") < fn.indexOf("db.transaction"));
  const tx = fn.slice(fn.indexOf("db.transaction"));
  assert.ok(tx.includes("tx.update(bd)") && tx.includes("tx.insert(auditLog)"));
  assert.match(tx, /\.for\("update"\)/, "the previous value is read under a row lock, or two admins record the same 'from'");
  assert.match(tx, /previousCap/);
});

test("setting and clearing are two audit actions beside the switch's two", async () => {
  const { LUSHA_AUDIT_ACTIONS } = await import("../../src/lib/lusha/adminDb");
  assert.deepEqual(LUSHA_AUDIT_ACTIONS, { enable: "bd_lusha_enable", disable: "bd_lusha_disable", capSet: "bd_lusha_cap_set", capCleared: "bd_lusha_cap_cleared" });
});

const RAW: RawUsageRow = { ur_bd_id: "b1", ur_name: "Ana", ur_email: "ana@bd.example", ur_role: "bd", ur_enabled: true, ur_created_at: "2026-10-01T00:00:00Z", ur_charged: "24", ur_pending: "0", ur_emails: "11", ur_phones: "0", ur_rejections: "0", ur_last_use: null, ur_toggle_by: null, ur_toggle_at: null, ur_personal_cap: null, ur_today_credits: "4" };

test("today's spend arrives as a number, and is its own CTE: ur_spend (the drill-down's reference) is untouched", async () => {
  assert.equal(mapUsageRow(RAW).todayCredits, 4);
  assert.equal(mapUsageRow({ ...RAW, ur_today_credits: 0 }).todayCredits, 0);
  const { buildUsageReportQuery } = await import("../../src/lib/lusha/adminDb");
  const now = new Date("2026-10-22T15:30:00.000Z");
  const q = dialect.sqlToQuery(buildUsageReportQuery({ start: new Date("2026-10-01T03:00:00Z"), end: new Date("2026-11-01T03:00:00Z") }, now));
  const text = norm(q.sql);
  const spend = text.match(/ur_spend as \((.*?)\), ur_rej as/)?.[1] ?? "";
  assert.ok(spend && !spend.includes("coalesce(credits_charged, credits_reserved)"), "ur_spend keeps charged-only credits");
  const day = text.match(/ur_day as \((.*?)\)(?:, \w+ as \(| select )/)?.[1] ?? "";
  assert.match(day, /coalesce\(sum\(coalesce\(credits_charged, credits_reserved\)\), 0\) as ur_day_credits/, "the cap's own definition of a credit spent");
  assert.match(day, /group by actor_bd_id/);
  const w = artDayWindow(now);
  assert.ok(q.params.includes(w.start.toISOString()) && q.params.includes(w.end.toISOString()), "the Argentina day the cap uses");
  assert.match(text, /left join ur_day \w+ on \w+\.ur_bd = b\.id/);
  assert.equal([...text.matchAll(/from lusha_reveal/g)].length, 4, "one more scan of the ledger, in the same statement: no new round trip");
});

test("the field has three outcomes that never merge: empty clears, a whole number in range is the cap, anything else is invalid and sends nothing", () => {
  assert.equal(readCapField("", 999), null);
  assert.equal(readCapField("   ", 999), null);
  assert.equal(readCapField("0", 999), 0);
  assert.equal(readCapField("08", 999), 8);
  assert.equal(readCapField("999", 999), 999);
  // What a type=number input reports as "" when it cannot parse the text: the field is plain text so the raw string is the truth.
  for (const junk of ["-", "e", "1e", "5-", "+", ".", "1.5", "-1", "1000", "1e2", "0x10", "٣", "5 5", "NaN", "Infinity"]) assert.equal(readCapField(junk, 999), undefined, junk);
  // The incident: a BD blocked at 0, the admin taps "-" and presses Save. Nothing may be sent (null would lift the block).
  assert.deepEqual(capSaveIntent("-", 999), { send: false });
  assert.deepEqual(capSaveIntent("", 999), { send: true, cap: null });
  assert.deepEqual(capSaveIntent("0", 999), { send: true, cap: 0 });
});

test("the editor sends only what capSaveIntent allows, and the field is text, not type=number", () => {
  assert.match(EDITOR, /capSaveIntent\(text, maxCap\)/);
  assert.match(EDITOR, /if \(!intent\.send\) return;/, "an invalid field returns before anything is sent");
  assert.equal([...EDITOR.matchAll(/setLushaPersonalCapAction\(/g)].length, 1, "one call site, reached only through the intent");
  assert.ok(EDITOR.indexOf("if (!intent.send) return;") < EDITOR.indexOf("setLushaPersonalCapAction(bdId, next)"));
  assert.doesNotMatch(EDITOR, /type="number"/);
  assert.doesNotMatch(EDITOR, /Number\(text\)/);
});

test("saving an unchanged value says nothing was changed instead of claiming a write", () => {
  assert.match(ACTIONS, /return \{ ok: result\.ok, changed: result\.ok \? result\.changed : false \}/);
  assert.match(EDITOR, /\.changed/);
  assert.match(EDITOR, /toastUnchanged/);
  for (const d of [es.lushaAdmin, en.lushaAdmin]) assert.ok(d.capToastUnchanged.includes("{name}"));
});

test("the zero warning tells the admin the same thing the BD is told: ask an administrator (BD copy: errorLushaPersonalCapReached)", () => {
  assert.match(es.lushaAdmin.capWarnZeroBody, /pedir a un administrador/);
  assert.doesNotMatch(es.lushaAdmin.capWarnZeroBody, /a vos/);
  assert.match(en.lushaAdmin.capWarnZeroBody, /ask an administrator/);
});

test("there is ONE definition of the contacts text: personalCapLines calls the shared helper, no second copy of its branches", () => {
  const usage = read("src/lib/lusha/usageReport.ts");
  assert.match(usage, /capContactsText\(credits, CREDITS_PER_CONTACT, d\)/);
  const fn = usage.slice(usage.indexOf("export function personalCapLines"));
  assert.doesNotMatch(fn, /personalContactsNone|personalContactsOne|personalContactsBlocked|Math\.floor|contactsWithinCredits/);
});

test("the live contacts text is the table's text for every cap, from the constant it is handed", () => {
  for (const d of [es.lushaAdmin, en.lushaAdmin]) {
    for (let credits = 0; credits <= MAX_PERSONAL_DAILY_CAP; credits++) {
      assert.equal(capContactsText(credits, CREDITS_PER_CONTACT, d), personalCapLines(credits, d).contacts, String(credits));
    }
  }
  assert.notEqual(capContactsText(8, CREDITS_PER_CONTACT, es.lushaAdmin), capContactsText(8, 4, es.lushaAdmin), "the divisor is an argument, not a literal");
});

test("the editor holds no credits-per-contact or rail literal, and only type-imports from the library", () => {
  assert.doesNotMatch(EDITOR, /\/\s*2\b|\/\s*6\b|\b2 cr|\b60\b|CREDITS_PER_CONTACT|DEFAULT_DAILY/);
  assert.match(EDITOR, /capContactsText\(typed, creditsPerContact, l\)/, "the divisor is the prop the server handed over");
  assert.doesNotMatch(EDITOR, /Math\.floor\([^)]*\/\s*\d/);
  for (const m of EDITOR.matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)) {
    if (/lib\/lusha/.test(m[2])) assert.ok(m[1], `${m[2]} must be a type-only import`);
  }
  assert.match(EDITOR, /^"use client";/);
  assert.match(EDITOR, /className="btn btn-ghost left"/);
  assert.match(EDITOR, /btn btn-ghost btn-icon btn-sm edit/);
});

test("the page hands the editor the constant, the rail and today's spend from the server, and the table text from personalCapLines", () => {
  assert.match(PAGE, /<LushaCapEditor/);
  assert.match(PAGE, /creditsPerContact=\{CREDITS_PER_CONTACT\}/);
  assert.match(PAGE, /dailyRail=\{limits\.dailyCap\}/);
  assert.match(PAGE, /todayCredits=\{r\.todayCredits\}/);
  assert.match(PAGE, /personalCapLines\(/);
  assert.match(PAGE, /getLushaUsageReport\(window, now\)/);
});

test("the editor's labels exist in both dictionaries with identical keys", () => {
  assert.deepEqual(Object.keys(es.lushaAdmin).sort(), Object.keys(en.lushaAdmin).sort());
  for (const k of ["capSet", "capEditAria", "capTitle", "capCreditsMany", "capClear", "capSave", "capWarnRailTitle", "capWarnZeroTitle", "capToastSet", "capToastCleared", "capToastBlocked"]) {
    assert.ok(k in es.lushaAdmin && k in en.lushaAdmin, k);
  }
});
