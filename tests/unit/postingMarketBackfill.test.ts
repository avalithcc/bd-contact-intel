import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketBackfillAuditMetadata,
  MAX_AUDITED_CHANGES,
  planPostingMarketChanges,
  summarizePostingMarketChanges,
  type PostingMarketRow,
} from "@/lib/hiring/marketBackfill";
import { classifyMarket, isMiamiArea } from "@/lib/hiring/markets";
// The PRODUCER of the stored values before this change: the frozen old classifier, not hand-typed markets.
import { classifyMarket as legacyMarket, isMiamiArea as legacyMiami } from "../../scripts/measure/legacyMarkets";

const LOCATIONS = [
  "Denver, CO, USA", // latam -> us
  "Chennai, TN, in", // us -> other
  "Toronto, ON, ca", // us -> other
  "Albuquerque, New Mexico", // latam -> us
  "Miami, FL", // unchanged
  "Bogotá, CO", // unchanged
  "Berlin, DE", // unchanged
];

const storedByOldRules = (): PostingMarketRow[] =>
  LOCATIONS.map((location, i) => ({ id: `00000000-0000-0000-0000-00000000000${i}`, location, market: legacyMarket(location), isMiami: legacyMiami(location) }));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

test("plans exactly the rows whose stored market differs from today's classifier", () => {
  const changes = planPostingMarketChanges(storedByOldRules());
  assert.deepEqual(
    changes.map((c) => `${c.fromMarket}>${c.toMarket}`),
    ["latam>us", "us>other", "us>other", "latam>us"],
  );
  assert.deepEqual(summarizePostingMarketChanges(changes), { changed: 4, byTransition: { "latam>us": 2, "us>other": 2 }, miamiFlips: 0 });
});

test("a pure planner: the same input gives the same plan twice and is never mutated", () => {
  const rows = deepFreeze(storedByOldRules());
  const snapshot = structuredClone(rows);
  const first = planPostingMarketChanges(rows);
  const second = planPostingMarketChanges(rows);
  assert.deepEqual(second, first);
  assert.deepEqual(rows, snapshot);
});

test("idempotent: once every change is applied, the next plan is empty", () => {
  const applied = storedByOldRules().map((row) => ({ ...row, market: classifyMarket(row.location), isMiami: isMiamiArea(row.location) }));
  assert.deepEqual(planPostingMarketChanges(applied), []);
});

test("a null stored market (never backfilled) is planned too", () => {
  const [change] = planPostingMarketChanges([{ id: "x", location: "Miami, FL", market: null, isMiami: true }]);
  assert.deepEqual(change, { id: "x", fromMarket: null, toMarket: "us", fromMiami: true, toMiami: true });
});

test("the audit metadata is the revert path: ids and previous values only, no location text", () => {
  const changes = planPostingMarketChanges(storedByOldRules());
  const metadata = buildMarketBackfillAuditMetadata(LOCATIONS.length, changes);
  assert.equal(metadata.scanned, LOCATIONS.length);
  assert.equal(metadata.changed, 4);
  assert.deepEqual(metadata.previous[0], { id: changes[0].id, market: "latam", isMiami: false });
  assert.equal(JSON.stringify(metadata).includes("Denver"), false);
});

test("refuses to audit a run too large for one revert row", () => {
  const many = Array.from({ length: MAX_AUDITED_CHANGES + 1 }, (_, i) => ({ id: String(i), fromMarket: "latam", toMarket: "us" as const, fromMiami: false, toMiami: false }));
  assert.throws(() => buildMarketBackfillAuditMetadata(many.length, many), /refusing to audit/);
});
