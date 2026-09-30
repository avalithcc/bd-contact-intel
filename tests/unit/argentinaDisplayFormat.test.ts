/**
 * Pins the launch-readiness audit's "two different dates for the same
 * event" bug: a Server Component used to format an instant with
 * `date-fns`'s `format(at, "d MMM", { locale: es })` and no timeZone, so it
 * rendered in the PROCESS timezone (UTC on Vercel) — the sibling Client
 * Component Timeline renders the identical instant in the BD's BROWSER
 * timezone (ART). An event at 22:30 ART on 2026-09-29 (2026-09-30T01:30:00Z)
 * showed "30 sep" server-side and "29 sep" client-side on the same page.
 *
 * Every `formatArgentina*` helper (src/lib/i18n/format.ts) must return the
 * SAME Argentina-local date/time for this instant regardless of the
 * process's own timezone — these tests must pass under both `TZ=UTC` and
 * `TZ=America/Argentina/Buenos_Aires`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatArgentinaDayMonth,
  formatArgentinaDayMonthTime,
  formatArgentinaDayMonthYear,
  formatArgentinaMonthYear,
} from "@/lib/i18n/format";

// 22:30 ART on 2026-09-29 — the exact cross-midnight window from the bug.
const CROSS_MIDNIGHT_INSTANT = new Date("2026-09-30T01:30:00Z");

test("formatArgentinaDayMonth renders the ART calendar date, not the process's own timezone date", () => {
  assert.equal(formatArgentinaDayMonth(CROSS_MIDNIGHT_INSTANT), "29 sep");
});

test("formatArgentinaDayMonthYear renders the ART calendar date with year", () => {
  assert.equal(formatArgentinaDayMonthYear(CROSS_MIDNIGHT_INSTANT), "29 sep 2026");
});

test("formatArgentinaDayMonthTime renders the ART calendar date AND clock time", () => {
  assert.equal(formatArgentinaDayMonthTime(CROSS_MIDNIGHT_INSTANT), "29 sep, 22:30");
});

test("formatArgentinaMonthYear renders the ART calendar month, capitalized", () => {
  assert.equal(formatArgentinaMonthYear(CROSS_MIDNIGHT_INSTANT), "Septiembre 2026");
  // A UTC month-boundary instant that is still the PREVIOUS ART month.
  assert.equal(formatArgentinaMonthYear(new Date("2026-10-01T01:30:00Z")), "Septiembre 2026");
});

test("a non-cross-midnight instant still renders consistently (regression guard against an off-by-one shift)", () => {
  assert.equal(formatArgentinaDayMonth(new Date("2026-09-29T15:00:00Z")), "29 sep");
});
