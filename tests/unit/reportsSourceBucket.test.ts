/**
 * Unit tests for src/lib/reports/sourceBucket.ts — "Conversión por origen"
 * (owner-reporting decision 8): bucketing `person.source_key`'s 5 real
 * values into the backlog's 3 named sources plus an "Otro" catch-all, then
 * folding per-(source,status) counts into a funnel-shaped row per bucket.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketSourceKey, buildSourceConversionRows } from "@/lib/reports/sourceBucket";

test("bucketSourceKey maps hubspot_import to hubspot", () => {
  assert.equal(bucketSourceKey("hubspot_import"), "hubspot");
});

test("bucketSourceKey maps both csv and linkedin_import to linkedin (decision 8)", () => {
  assert.equal(bucketSourceKey("csv"), "linkedin");
  assert.equal(bucketSourceKey("linkedin_import"), "linkedin");
});

test("bucketSourceKey maps manual_create to manual", () => {
  assert.equal(bucketSourceKey("manual_create"), "manual");
});

test("bucketSourceKey buckets anything else, including null, into other", () => {
  assert.equal(bucketSourceKey("lead_import"), "other");
  assert.equal(bucketSourceKey(null), "other");
  assert.equal(bucketSourceKey("some_future_seed_key"), "other");
});

test("buildSourceConversionRows folds raw (sourceKey,status,count) triples into cumulative funnel rows per bucket", () => {
  const rows = buildSourceConversionRows([
    { sourceKey: "hubspot_import", status: "new", count: 30 },
    { sourceKey: "hubspot_import", status: "contacted", count: 20 },
    { sourceKey: "hubspot_import", status: "replied", count: 10 },
    { sourceKey: "hubspot_import", status: "meeting", count: 4 },
    { sourceKey: "csv", status: "new", count: 50 },
    { sourceKey: "linkedin_import", status: "contacted", count: 5 },
  ]);
  const hubspot = rows.find((r) => r.bucket === "hubspot")!;
  // Cumulative: "new" total counts everyone; "contacted" counts contacted-or-further, etc.
  assert.equal(hubspot.newCount, 30 + 20 + 10 + 4);
  assert.equal(hubspot.contactedCount, 20 + 10 + 4);
  assert.equal(hubspot.repliedCount, 10 + 4);
  assert.equal(hubspot.meetingCount, 4);

  const linkedin = rows.find((r) => r.bucket === "linkedin")!;
  assert.equal(linkedin.newCount, 50 + 5, "csv's 'new' and linkedin_import's 'contacted' both fold into the same bucket");
  assert.equal(linkedin.contactedCount, 5);
});

test("buildSourceConversionRows always returns all 4 buckets in a fixed order, even with zero rows", () => {
  const rows = buildSourceConversionRows([]);
  assert.deepEqual(
    rows.map((r) => r.bucket),
    ["hubspot", "linkedin", "manual", "other"],
  );
  assert.ok(rows.every((r) => r.newCount === 0 && r.contactedCount === 0 && r.repliedCount === 0 && r.meetingCount === 0));
});

test("buildSourceConversionRows never mutates its input", () => {
  const input = [{ sourceKey: "hubspot_import", status: "new", count: 3 }];
  const clone = JSON.parse(JSON.stringify(input));
  buildSourceConversionRows(input);
  assert.deepEqual(input, clone);
});

test("a discarded person contributes to none of the 4 cumulative stage buckets (matches the funnel card's own convention)", () => {
  const rows = buildSourceConversionRows([{ sourceKey: "manual_create", status: "discarded", count: 7 }]);
  const manual = rows.find((r) => r.bucket === "manual")!;
  assert.equal(manual.newCount, 0);
  assert.equal(manual.contactedCount, 0);
});
