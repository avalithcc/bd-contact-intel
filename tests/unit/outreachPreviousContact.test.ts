/**
 * Pure priority rule behind the Outreach "Contacto previo" column: the newest
 * attributed touch wins, the owner is the labelled fallback, and anything that
 * cannot be NAMED resolves to null (the cell's "sin registro" state). No DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { WORKED_ACTIVITY_TYPES } from "@/lib/followUp/queueSelection";
import { PREVIOUS_CONTACT_ACTIVITY_TYPES, resolvePreviousContact, formatDayMonth, type PreviousContactRaw } from "@/lib/outreach/previousContact";
import { t } from "@/lib/i18n/dictionaries";

const dict = t("es");
const AT = "2026-11-12T15:00:00+00:00";
const raw = (over: Partial<PreviousContactRaw> = {}): PreviousContactRaw => ({ source: "email_sent", bdId: "b1", name: "Macarena Dávila", at: AT, ...over });
const owner = { bdId: "b2", name: "Cristian Civita" };

test("a recorded touch beats the owner and carries the touch's own label", () => {
  const r = resolvePreviousContact(raw(), owner, dict);
  assert.equal(r?.name, "Macarena Dávila");
  assert.equal(r?.label, dict.contactList.lastActivityEmailSent);
  assert.notEqual(r?.label, dict.outreach.previousContactOwner);
  assert.equal(r?.at?.toISOString(), "2026-11-12T15:00:00.000Z");
});

test("LinkedIn touch uses the unqualified LinkedIn label", () => {
  const r = resolvePreviousContact(raw({ source: "linkedin_message" }), null, dict);
  assert.equal(r?.label, dict.contactList.lastActivityLinkedin);
});

test("no touch falls back to the owner, labelled with the plain owner word and no date", () => {
  const r = resolvePreviousContact(null, owner, dict);
  assert.deepEqual({ name: r?.name, label: r?.label, at: r?.at }, {
    name: "Cristian Civita",
    label: dict.outreach.previousContactOwner,
    at: null,
  });
});

test("neither touch nor owner is null", () => {
  assert.equal(resolvePreviousContact(null, null, dict), null);
  assert.equal(resolvePreviousContact(undefined, undefined, dict), null);
});

test("a BD with no name never renders as a uuid or empty name", () => {
  assert.equal(resolvePreviousContact(raw({ bdId: "gone", name: null }), null, dict), null);
  assert.equal(resolvePreviousContact(raw({ bdId: "gone", name: "" }), null, dict), null);
  assert.equal(resolvePreviousContact(null, { bdId: "gone", name: null }, dict), null);
  assert.equal(resolvePreviousContact(null, { bdId: null, name: null }, dict), null);
});

test("a nameless touch falls through to a named owner", () => {
  const r = resolvePreviousContact(raw({ bdId: "gone", name: null }), owner, dict);
  assert.equal(r?.label, dict.outreach.previousContactOwner);
});

test("a null touch time keeps the attribution without a date", () => {
  const r = resolvePreviousContact(raw({ source: "linkedin_message", at: null }), null, dict);
  assert.equal(r?.name, "Macarena Dávila");
  assert.equal(r?.at, null);
});

test("an offset-less driver string is read as UTC, whatever the process timezone", () => {
  // new Date("2026-11-12T15:00:00") reads local time: only a non-UTC process shows the difference,
  // so force one (restored in finally) instead of relying on the machine's TZ.
  const before = process.env.TZ;
  process.env.TZ = "America/Argentina/Buenos_Aires";
  try {
    const r = resolvePreviousContact(raw({ at: "2026-11-12T15:00:00" }), null, dict);
    assert.equal(r?.at?.toISOString(), "2026-11-12T15:00:00.000Z");
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test("dd/mm is the Argentina calendar day, zero padded", () => {
  assert.equal(formatDayMonth(new Date("2026-11-12T15:00:00Z")), "12/11");
  assert.equal(formatDayMonth(new Date("2026-03-02T01:00:00Z")), "01/03");
});

test("the allow-list excludes every no-progress type and discarded, and keeps the worked types", () => {
  const allowed = new Set(PREVIOUS_CONTACT_ACTIVITY_TYPES);
  for (const type of NO_PROGRESS_ACTIVITY_TYPES) assert.ok(!allowed.has(type), `${type} must not name a contact`);
  assert.ok(!allowed.has("discarded"));
  for (const type of WORKED_ACTIVITY_TYPES) if (type !== "discarded") assert.ok(allowed.has(type), type);
  assert.ok(allowed.has("email_sent"));
});

test("dictionary keys exist in both languages", () => {
  for (const l of ["es", "en"] as const) {
    const o = t(l).outreach;
    assert.ok(o.tablePreviousContact && o.previousContactOwner && o.previousContactNone, l);
  }
  assert.equal(dict.outreach.previousContactOwner, "Dueño");
});
