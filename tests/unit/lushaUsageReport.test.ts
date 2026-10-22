/** lusha-per-bd: the pure half of the admin report (period windows, row normalisation, totals). No DB, no network. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewBd, mapUsageRow, parseReportPeriod, periodWindow, shareOf, summarizeUsage, type RawUsageRow } from "@/lib/lusha/usageReport";

// Friday 16 Oct 2026, noon in Argentina (UTC-3).
const NOW = new Date("2026-10-16T15:00:00Z");

test("the period defaults to the month and ignores anything it does not know", () => {
  assert.equal(parseReportPeriod(undefined), "month");
  assert.equal(parseReportPeriod("year"), "month");
  assert.deepEqual(["week", "month", "quarter"].map(parseReportPeriod), ["week", "month", "quarter"]);
});

test("windows are Argentina calendar periods as real instants, end exclusive", () => {
  const month = periodWindow("month", NOW);
  assert.deepEqual([month.start.toISOString(), month.end.toISOString()], ["2026-10-01T03:00:00.000Z", "2026-11-01T03:00:00.000Z"]);
  assert.deepEqual([month.firstDay, month.today], ["2026-10-01", "2026-10-16"]);
  const week = periodWindow("week", NOW); // weeks start on Monday
  assert.deepEqual([week.start.toISOString(), week.end.toISOString(), week.firstDay], ["2026-10-12T03:00:00.000Z", "2026-10-19T03:00:00.000Z", "2026-10-12"]);
  const quarter = periodWindow("quarter", NOW);
  assert.deepEqual([quarter.start.toISOString(), quarter.end.toISOString()], ["2026-10-01T03:00:00.000Z", "2027-01-01T03:00:00.000Z"]);
  assert.equal(periodWindow("quarter", new Date("2026-08-31T12:00:00Z")).firstDay, "2026-07-01");
  assert.equal(periodWindow("week", new Date("2026-10-18T12:00:00Z")).firstDay, "2026-10-12"); // Sunday belongs to the week that began on Monday
});

test("the window is a pure function of its input", () => {
  const a = periodWindow("month", NOW);
  const b = periodWindow("month", NOW);
  assert.deepEqual(a, b);
  assert.equal(NOW.toISOString(), "2026-10-16T15:00:00.000Z");
});

const raw = (over: Partial<RawUsageRow> = {}): RawUsageRow => ({
  ur_bd_id: "bd-1",
  ur_name: "Lucia",
  ur_email: "lucia@bd.example",
  ur_role: "bd",
  ur_enabled: true,
  ur_created_at: "2026-10-15 10:00:00+00",
  ur_charged: "65",
  ur_pending: "3",
  ur_emails: "17",
  ur_phones: "5",
  ur_rejections: "2",
  ur_last_use: "2026-10-15 12:00:00.5+00",
  ur_toggle_by: null,
  ur_toggle_at: null,
  ur_personal_cap: null,
  ...over,
});

test("raw SQL strings come back as numbers and dates", () => {
  const row = mapUsageRow(raw());
  assert.deepEqual([row.chargedCredits, row.pendingCredits, row.emails, row.phones, row.rejections], [65, 3, 17, 5, 2]);
  assert.ok(row.lastUseAt instanceof Date && row.createdAt instanceof Date);
  assert.equal(row.lastUseAt!.toISOString(), "2026-10-15T12:00:00.500Z");
  assert.deepEqual([mapUsageRow(raw({ ur_last_use: null })).lastUseAt, mapUsageRow(raw({ ur_toggle_at: null })).toggledAt], [null, null]);
});

test("totals count every BD, disabled ones included, and never mutate the rows", () => {
  const rows = [mapUsageRow(raw()), mapUsageRow(raw({ ur_bd_id: "bd-2", ur_enabled: false, ur_charged: "33", ur_pending: "0", ur_emails: "10", ur_phones: "2", ur_rejections: "0" }))];
  const before = JSON.stringify(rows);
  const first = summarizeUsage(rows);
  assert.deepEqual(first, summarizeUsage(rows));
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(first, { bds: 2, enabled: 1, chargedCredits: 98, pendingCredits: 3, emails: 27, phones: 7, reveals: 34, rejections: 2 });
});

test("'Nueva' only marks a BD that still has the new-BD default: a recent BD the migration left enabled is not new", () => {
  const now = new Date("2026-10-16T15:00:00Z");
  const recent = mapUsageRow(raw({ ur_created_at: "2026-10-10 10:00:00+00" }));
  assert.equal(isNewBd({ ...recent, lushaEnabled: true }, now), false, "created in the window but enabled (pre-0047)");
  assert.equal(isNewBd({ ...recent, lushaEnabled: false }, now), true);
  assert.equal(isNewBd({ ...recent, lushaEnabled: false, toggledAt: new Date("2026-10-12T10:00:00Z") }, now), false, "an admin already decided");
  assert.equal(isNewBd({ ...recent, lushaEnabled: false, createdAt: new Date("2026-09-01T10:00:00Z") }, now), false, "too old");
});

test("a BD's share of the period is a whole percentage, zero when nothing was spent", () => {
  assert.equal(shareOf(65, 130), 50);
  assert.equal(shareOf(9, 130), 7);
  assert.equal(shareOf(5, 0), 0);
});
