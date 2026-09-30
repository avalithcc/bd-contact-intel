/**
 * Unit tests for src/lib/db/timestamp.ts — the ONE shared helper every raw
 * `db.execute`/computed-`sql`-expression call site uses to coerce a
 * postgres-js wire timestamp string back into a real UTC `Date`. Every
 * timestamp column in this schema is `timestamp without time zone` holding
 * UTC (CLAUDE.md query rule 2); an offset-less wire string must be pinned to
 * UTC explicitly here rather than trusting `new Date(str)` to guess the same
 * thing the DB meant (that guess uses the *process's* local timezone, which
 * is only UTC by accident on Vercel prod).
 *
 * Run twice — `TZ=UTC npm run test:unit` and
 * `TZ=America/Argentina/Buenos_Aires npm run test:unit` — every assertion
 * below must produce the identical `getTime()` under both, since the whole
 * point of `parseDbTimestamp` is to make that TRUE regardless of the
 * process's local timezone.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDbTimestamp } from "@/lib/db/timestamp";

const EXPECTED_UTC_MS = Date.UTC(2026, 8, 29, 0, 0, 0); // 2026-09-29T00:00:00Z
const TZ_LABEL = `TZ=${process.env.TZ ?? "(unset)"}`;

test(`parseDbTimestamp: space-separated, offset-less string is pinned to UTC (${TZ_LABEL})`, () => {
  const d = parseDbTimestamp("2026-09-29 00:00:00");
  assert.equal(d.getTime(), EXPECTED_UTC_MS);
});

test(`parseDbTimestamp: 'T'-separated, offset-less string is pinned to UTC (${TZ_LABEL})`, () => {
  const d = parseDbTimestamp("2026-09-29T00:00:00");
  assert.equal(d.getTime(), EXPECTED_UTC_MS);
});

test(`parseDbTimestamp: offset-less string with fractional seconds is pinned to UTC (${TZ_LABEL})`, () => {
  const d = parseDbTimestamp("2026-09-29 00:00:00.123456");
  assert.equal(d.getTime(), EXPECTED_UTC_MS + 123);
});

test(`parseDbTimestamp: explicit 'Z' suffix is trusted as-is, not double-pinned (${TZ_LABEL})`, () => {
  const d = parseDbTimestamp("2026-09-29T00:00:00Z");
  assert.equal(d.getTime(), EXPECTED_UTC_MS);
});

test(`parseDbTimestamp: postgres's bare two-digit offset ('+00', no colon, no minutes — the real driver format for a zero-minute UTC offset) is trusted as-is (${TZ_LABEL})`, () => {
  const d = parseDbTimestamp("2026-09-25 13:30:00+00");
  assert.equal(d.getTime(), Date.UTC(2026, 8, 25, 13, 30, 0));
});

test(`parseDbTimestamp: a colon-separated negative offset (e.g. to_json's '-03:00') is trusted as-is, converted to the correct UTC instant (${TZ_LABEL})`, () => {
  const d = parseDbTimestamp("2026-09-25T13:30:00-03:00");
  assert.equal(d.getTime(), Date.UTC(2026, 8, 25, 16, 30, 0));
});

test(`parseDbTimestamp: a Date instance passes through unchanged, byte-identical instant (${TZ_LABEL})`, () => {
  const original = new Date("2026-09-25T13:30:00Z");
  const result = parseDbTimestamp(original);
  assert.equal(result, original);
  assert.equal(result.getTime(), original.getTime());
});
