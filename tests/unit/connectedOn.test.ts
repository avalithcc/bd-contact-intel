/**
 * Unit tests for src/lib/migration/connectedOn.ts — parsing LinkedIn's
 * `Connected On` export text (design.md "Migration plan": the script
 * parses LinkedIn's `"12 Mar 2021"` text; unparseable dates sort last).
 * Pure, no DB — run with: npx tsx --test tests/unit/connectedOn.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConnectedOnDate } from "@/lib/migration/connectedOn";

test("parses LinkedIn's canonical 'DD Mon YYYY' format", () => {
  const date = parseConnectedOnDate("12 Mar 2021");
  assert.ok(date);
  assert.equal(date.getUTCFullYear(), 2021);
  assert.equal(date.getUTCMonth(), 2); // March = index 2
  assert.equal(date.getUTCDate(), 12);
});

test("is case-insensitive on the month abbreviation", () => {
  const date = parseConnectedOnDate("1 JAN 2020");
  assert.ok(date);
  assert.equal(date.getUTCMonth(), 0);
});

test("trims surrounding whitespace", () => {
  const date = parseConnectedOnDate("  5 Jul 2019  ");
  assert.ok(date);
  assert.equal(date.getUTCDate(), 5);
});

test("returns null for null/undefined/blank input", () => {
  assert.equal(parseConnectedOnDate(null), null);
  assert.equal(parseConnectedOnDate(undefined), null);
  assert.equal(parseConnectedOnDate("   "), null);
});

test("returns null for unrecognized formats", () => {
  assert.equal(parseConnectedOnDate("2021-03-12"), null);
  assert.equal(parseConnectedOnDate("March 12, 2021"), null);
  assert.equal(parseConnectedOnDate("not a date"), null);
});

test("returns null for an impossible calendar date instead of rolling over", () => {
  assert.equal(parseConnectedOnDate("31 Feb 2021"), null);
});

test("earlier date compares less than a later one (for owner-selection sort)", () => {
  const a = parseConnectedOnDate("1 Jan 2020")!;
  const b = parseConnectedOnDate("2 Jan 2020")!;
  assert.ok(a.getTime() < b.getTime());
});
