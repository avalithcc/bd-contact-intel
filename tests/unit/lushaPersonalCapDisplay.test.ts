process.env.DATABASE_URL ??= "postgres://unit:unit@127.0.0.1:1/unit";

import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { CREDITS_PER_CONTACT } from "../../src/lib/lusha/cap";
import { mapUsageRow, personalCapLines, type RawUsageRow } from "../../src/lib/lusha/usageReport";
import { en } from "../../src/lib/i18n/dictionaries/en";
import { es } from "../../src/lib/i18n/dictionaries/es";

const RAW: RawUsageRow = { ur_bd_id: "b1", ur_name: "Ana", ur_email: "ana@bd.example", ur_role: "bd", ur_enabled: true, ur_created_at: "2026-10-01T00:00:00Z", ur_charged: "24", ur_pending: "0", ur_emails: "11", ur_phones: "0", ur_rejections: "0", ur_last_use: null, ur_toggle_by: null, ur_toggle_at: null, ur_personal_cap: null, ur_today_credits: 0 };

test("a BD with no personal cap maps to null, and a cap arrives as a number whichever way the driver sends it", () => {
  assert.equal(mapUsageRow(RAW).personalDailyCap, null);
  assert.equal(mapUsageRow({ ...RAW, ur_personal_cap: 12 }).personalDailyCap, 12);
  assert.equal(mapUsageRow({ ...RAW, ur_personal_cap: "12" }).personalDailyCap, 12);
  assert.equal(mapUsageRow({ ...RAW, ur_personal_cap: 0 }).personalDailyCap, 0, "0 is a cap (blocked), not an absence");
});

test("the admin line shows the credits AND the contacts they buy, computed from the credits-per-contact constant", () => {
  for (const d of [es.lushaAdmin, en.lushaAdmin]) {
    const twelve = personalCapLines(12, d);
    assert.ok(twelve.headline.includes("12"));
    assert.ok(twelve.contacts.includes(String(12 / CREDITS_PER_CONTACT)), twelve.contacts);
    assert.ok(personalCapLines(30, d).contacts.includes(String(30 / CREDITS_PER_CONTACT)), "no hardcoded 6");
    assert.ok(personalCapLines(1, d).headline.includes("1"));
    assert.notEqual(personalCapLines(1, d).contacts, personalCapLines(12, d).contacts);
    assert.notEqual(personalCapLines(2, d).contacts, personalCapLines(1, d).contacts);
  }
  for (const d of [es.lushaAdmin, en.lushaAdmin]) {
    const zero = personalCapLines(0, d);
    assert.equal(zero.contacts, d.personalContactsBlocked, "0 is the kill switch: the admin reads it as blocked");
    assert.notEqual(zero.contacts, personalCapLines(1, d).contacts, "and not as a very small allowance");
    assert.doesNotMatch(zero.contacts, /habilit|enabled|switch/i);
  }
  assert.deepEqual(personalCapLines(12, es.lushaAdmin), { headline: "Tope: 12 créditos/día", contacts: "~6 contactos" });
});

// The line shares one narrow table cell with the switch above it and an edit pencil beside it, and the
// owner reported the pencil wrapping to its own row (2026-10-22) when the copy was 49 characters. The
// cap moved to 39, so the bound is the REASON the copy is short, which a golden string alone does not
// say. It does not check pixels: a longer word in a future locale can still wrap, and a narrower
// column would too. It only stops this copy from silently growing back.
const CAP_LINE_BUDGET = 42;

test("the admin cap line stays short enough that the edit pencil keeps its row", () => {
  for (const [locale, d] of [["es", es.lushaAdmin], ["en", en.lushaAdmin]] as const) {
    for (let credits = 0; credits <= 999; credits += 1) {
      const { headline, contacts } = personalCapLines(credits, d);
      const rendered = `${headline} · ${contacts}`;
      assert.ok(rendered.length <= CAP_LINE_BUDGET, `${locale} at ${credits} credits: ${rendered.length} chars > ${CAP_LINE_BUDGET} (${rendered})`);
    }
  }
});

test("the approximation survives shortening: the contacts figure never claims to be exact", () => {
  // A contact costs 2 credits when the reveal is an email; a phone costs more, so the figure is an
  // estimate. "unos"/"about" carried that and was dropped for length, so "~" has to carry it now.
  for (const d of [es.lushaAdmin, en.lushaAdmin]) {
    assert.match(personalCapLines(12, d).contacts, /^~/, "a plural contacts figure is hedged");
    assert.match(personalCapLines(30, d).contacts, /^~/);
  }
});

test("the usage report selects the personal cap from bd, outside the ur_spend CTE the drill-down is compared against", async () => {
  const { buildUsageReportQuery } = await import("@/lib/lusha/adminDb");
  const compiled = new PgDialect().sqlToQuery(buildUsageReportQuery({ start: new Date("2026-10-01T03:00:00Z"), end: new Date("2026-11-01T03:00:00Z") }));
  const text = compiled.sql.replace(/\s+/g, " ");
  assert.match(text, /b\.lusha_personal_daily_credit_cap as ur_personal_cap/);
  const spend = text.match(/ur_spend as \((.*?)\), ur_rej as/)?.[1] ?? "";
  assert.doesNotMatch(spend, /personal/);
});
