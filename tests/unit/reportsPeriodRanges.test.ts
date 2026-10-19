/**
 * Look-back preset (last month) and the custom Desde-Hasta range for /admin/reports.
 * Every boundary is an Argentina calendar-day instant, same helpers as the current-period presets.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCustomRange, reportPeriodRange, resolveReportPeriod } from "@/lib/reports/period";
import { buildReportsHref } from "@/lib/reports/reportsHref";

test("resolveReportPeriod accepts the look-back preset and the custom range", () => {
  for (const p of ["last_month", "custom"]) assert.equal(resolveReportPeriod(p), p);
});

test("'last_month' steps back one calendar month, across the year boundary too", () => {
  const month = reportPeriodRange("last_month", new Date("2026-10-19T14:00:00Z"));
  assert.deepEqual([month.fromDate, month.toDateExclusive, month.toIso], ["2026-09-01", "2026-10-01", "2026-10-01T03:00:00.000Z"]);
  const january = reportPeriodRange("last_month", new Date("2026-01-15T14:00:00Z"));
  assert.deepEqual([january.fromDate, january.toDateExclusive], ["2025-12-01", "2026-01-01"]);
});

test("the ART week turns over at Monday 00:00 ART (03:00Z), not at UTC midnight", () => {
  const sundayNight = reportPeriodRange("week", new Date("2026-10-19T02:59:00Z")); // Sunday 23:59 ART
  assert.equal(sundayNight.fromDate, "2026-10-12");
  const monday = reportPeriodRange("week", new Date("2026-10-19T03:00:00Z"));
  assert.equal(monday.fromDate, "2026-10-19");
  assert.equal(monday.fromIso, "2026-10-19T03:00:00.000Z");
});

test("'custom' covers the ART days from..to inclusive and never runs past now", () => {
  const range = reportPeriodRange("custom", new Date("2026-10-19T14:00:00Z"), { from: "2026-10-05", to: "2026-10-07" });
  assert.deepEqual([range.fromIso, range.toIso, range.toDateExclusive], ["2026-10-05T03:00:00.000Z", "2026-10-08T03:00:00.000Z", "2026-10-08"]);
  const future = reportPeriodRange("custom", new Date("2026-10-19T14:00:00Z"), { from: "2026-10-15", to: "2026-11-30" });
  assert.equal(future.toIso, "2026-10-19T14:00:00.000Z");
});

test("parseCustomRange accepts a real, ordered, bounded range and rejects everything else", () => {
  assert.deepEqual(parseCustomRange("2026-10-05", "2026-10-07"), { from: "2026-10-05", to: "2026-10-07" });
  assert.deepEqual(parseCustomRange("2026-10-05", "2026-10-05"), { from: "2026-10-05", to: "2026-10-05" });
  assert.equal(parseCustomRange("2026-10-07", "2026-10-05"), null);
  assert.equal(parseCustomRange("2026-02-30", "2026-03-05"), null);
  assert.equal(parseCustomRange("nope", "2026-03-05"), null);
  assert.equal(parseCustomRange(undefined, "2026-03-05"), null);
  assert.equal(parseCustomRange("2024-01-01", "2026-03-05"), null, "span is capped");
});

test("reportPeriodRange does not mutate the custom range it receives", () => {
  const custom = { from: "2026-10-05", to: "2026-10-07" };
  const first = reportPeriodRange("custom", new Date("2026-10-19T14:00:00Z"), custom);
  const second = reportPeriodRange("custom", new Date("2026-10-19T14:00:00Z"), custom);
  assert.deepEqual(custom, { from: "2026-10-05", to: "2026-10-07" });
  assert.deepEqual(first, second);
});

test("buildReportsHref carries the custom range, and only for the custom period", () => {
  assert.equal(buildReportsHref("custom", null, { from: "2026-10-05", to: "2026-10-07" }), "/admin/reports?period=custom&from=2026-10-05&to=2026-10-07");
  assert.equal(buildReportsHref("last_month", null, { from: "2026-10-05", to: "2026-10-07" }), "/admin/reports?period=last_month");
  assert.equal(buildReportsHref("month", null), "/admin/reports");
});

test("isValidReportWindow: ordered, parseable and at most the longest custom range", async () => {
  const { isValidReportWindow } = await import("@/lib/reports/period");
  assert.equal(isValidReportWindow("2026-10-01T03:00:00.000Z", "2026-10-19T14:00:00.000Z"), true);
  assert.equal(isValidReportWindow("2026-10-19T14:00:00.000Z", "2026-10-19T14:00:00.000Z"), false, "from must be < to");
  assert.equal(isValidReportWindow("2026-10-19T14:00:00.000Z", "2026-10-01T03:00:00.000Z"), false);
  assert.equal(isValidReportWindow("nope", "2026-10-01T03:00:00.000Z"), false);
  assert.equal(isValidReportWindow("2020-01-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"), false, "over 400 days");
  const custom = reportPeriodRange("custom", new Date("2026-10-19T14:00:00Z"), parseCustomRange("2025-09-14", "2026-10-18"));
  assert.equal(isValidReportWindow(custom.fromIso, custom.toIso), true, "the widest accepted custom range passes");
});

test("endIso is the end of the FULL period (still ahead for a current one) while toIso stops at now", () => {
  const range = reportPeriodRange("week", new Date("2026-10-22T15:00:00Z"));
  assert.equal(range.toIso, "2026-10-22T15:00:00.000Z");
  assert.equal(range.endIso, "2026-10-26T03:00:00.000Z");
  const past = reportPeriodRange("last_month", new Date("2026-10-22T15:00:00Z"));
  assert.equal(past.endIso, past.toIso);
});

test("a running period's label ends today: Monday is a single day, Thursday and Sunday span from Monday", () => {
  const label = (period: "week" | "month", iso: string) => reportPeriodRange(period, new Date(iso)).label;
  assert.equal(label("week", "2026-10-19T14:00:00Z"), "lun 19 oct (hoy)");
  assert.equal(label("week", "2026-10-22T15:00:00Z"), "lun 19 – jue 22 oct");
  assert.equal(label("week", "2026-10-25T15:00:00Z"), "lun 19 – dom 25 oct");
  assert.equal(label("week", "2026-10-29T15:00:00Z"), "lun 26 – jue 29 oct");
  assert.equal(label("week", "2026-11-04T15:00:00Z"), "lun 2 – mié 4 nov");
  assert.equal(label("week", "2026-10-02T15:00:00Z"), "lun 28 sep – vie 2 oct", "a week across two months names both");
});

test("this month's label ends today; on the 1st it is a single day", () => {
  assert.equal(reportPeriodRange("month", new Date("2026-10-19T14:00:00Z")).label, "1 – 19 oct");
  assert.equal(reportPeriodRange("month", new Date("2026-10-01T14:00:00Z")).label, "jue 1 oct (hoy)");
  assert.equal(reportPeriodRange("month", new Date("2026-10-01T02:59:00Z")).label, "1 – 30 sep", "30 Sep 23:59 ART is still September");
});

test("the label follows the ART day, not the UTC one", () => {
  assert.equal(reportPeriodRange("week", new Date("2026-10-19T02:59:00Z")).label, "lun 12 – dom 18 oct");
  assert.equal(reportPeriodRange("week", new Date("2026-10-19T03:00:00Z")).label, "lun 19 oct (hoy)");
});

test("a closed period names its full range; a custom one always names both ends with the year", () => {
  assert.equal(reportPeriodRange("last_month", new Date("2026-10-19T14:00:00Z")).label, "1 – 30 sep 2026");
  const custom = (from: string, to: string) => reportPeriodRange("custom", new Date("2026-10-19T14:00:00Z"), { from, to }).label;
  assert.equal(custom("2026-10-01", "2026-10-19"), "1 oct – 19 oct 2026");
  assert.equal(custom("2025-12-30", "2026-01-02"), "30 dic 2025 – 2 ene 2026");
  assert.equal(custom("2026-10-07", "2026-10-07"), "7 oct 2026");
  assert.equal(custom("2026-10-15", "2026-10-20"), "15 oct – 19 oct 2026", "an end past today is shown as today");
});

test("lastDate is the last day covered: today for a running period, the period's own last day otherwise", () => {
  assert.equal(reportPeriodRange("week", new Date("2026-10-22T15:00:00Z")).lastDate, "2026-10-22");
  assert.equal(reportPeriodRange("last_month", new Date("2026-10-22T15:00:00Z")).lastDate, "2026-09-30");
});

test("parseCustomRange with a clock refuses an end later than tomorrow (ART) and keeps today and tomorrow", () => {
  const now = new Date("2026-10-19T14:00:00Z");
  assert.deepEqual(parseCustomRange("2026-10-01", "2026-10-19", now), { from: "2026-10-01", to: "2026-10-19" });
  assert.deepEqual(parseCustomRange("2026-10-01", "2026-10-20", now), { from: "2026-10-01", to: "2026-10-20" });
  assert.equal(parseCustomRange("2026-10-01", "2026-10-21", now), null);
  assert.equal(parseCustomRange("2026-10-01", "2026-12-31", now), null);
});

test("an old URL with a removed period falls back to the month, never an error", () => {
  for (const removed of ["quarter", "last_week", "last_quarter"]) assert.equal(resolveReportPeriod(removed), "month");
});
