import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONNECTIONS_BATCH_MAX_ROWS,
  CONNECTIONS_BATCH_SIZE,
  emptyImportTotals,
  runBatchedImport,
  sanitizeConnectionsBatch,
  splitIntoBatches,
  type ImportBatchOutcome,
} from "@/lib/contacts/importBatches";
import { parseConnectionsCsv } from "@/lib/csv";

const outcome = (o: Partial<ImportBatchOutcome> = {}): ImportBatchOutcome => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  skippedOwnCompany: 0,
  identityReport: null,
  ...o,
});

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    profileKey: `linkedin.com/in/p${i}`,
    firstName: "A",
    lastName: "B",
    company: null,
    position: null,
    email: null,
    connectedOn: null,
  }));

test("splitIntoBatches: slices in order and keeps the remainder", () => {
  const parts = splitIntoBatches(rows(2500), 1000);
  assert.deepEqual(parts.map((p) => p.length), [1000, 1000, 500]);
  assert.equal(parts[2][0].profileKey, "linkedin.com/in/p2000");
});

test("the default batch size fits the server cap", () => {
  assert.ok(CONNECTIONS_BATCH_SIZE <= CONNECTIONS_BATCH_MAX_ROWS);
});

test("runBatchedImport: sums counts and the identity report across batches and reports progress", async () => {
  const seen: number[] = [];
  const result = await runBatchedImport(rows(25), {
    batchSize: 10,
    send: async (batch) => ({
      ok: true as const,
      outcome: outcome({
        created: batch.length - 1,
        updated: 1,
        skippedOwnCompany: 1,
        identityReport: { rowsRead: batch.length, ownCompanySkipped: 0, autoMerged: 1, flaggedForReview: 0, new: batch.length - 1 },
      }),
    }),
    onProgress: (done) => seen.push(done),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [10, 20, 25]);
  if (!result.ok) return;
  assert.equal(result.totals.created, 22);
  assert.equal(result.totals.updated, 3);
  assert.equal(result.totals.skippedOwnCompany, 3);
  assert.equal(result.totals.identityReport?.autoMerged, 3);
  assert.equal(result.totals.identityReport?.rowsRead, 25);
});

test("runBatchedImport: stops at the first failing batch and says which one, keeping earlier totals", async () => {
  let calls = 0;
  const result = await runBatchedImport(rows(30), {
    batchSize: 10,
    send: async () => {
      calls++;
      if (calls === 2) throw new Error("boom");
      return { ok: true as const, outcome: outcome({ created: 10 }) };
    },
  });
  assert.equal(calls, 2, "no batch after the failure is sent");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failedBatch, 2);
  assert.equal(result.totalBatches, 3);
  assert.equal(result.totals.created, 10);
  assert.match(result.detail ?? "", /boom/);
});

test("runBatchedImport: a send that returns a failure result also stops", async () => {
  const result = await runBatchedImport(rows(20), {
    batchSize: 10,
    send: async () => ({ ok: false as const, detail: "nope" }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failedBatch, 1);
  assert.equal(result.detail, "nope");
});

test("emptyImportTotals gives independent objects", () => {
  const a = emptyImportTotals();
  a.created = 5;
  assert.equal(emptyImportTotals().created, 0);
});

test("sanitizeConnectionsBatch: accepts parser output (fixture built from the real producer)", () => {
  const csv =
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On\nJane,Doe,https://www.linkedin.com/in/Jane/,,Acme,CEO,01 Jan 2025\n";
  const parsed = parseConnectionsCsv(csv);
  const out = sanitizeConnectionsBatch(JSON.parse(JSON.stringify(parsed)));
  assert.deepEqual(out, parsed);
});

test("sanitizeConnectionsBatch: rejects non-arrays and oversized batches, drops rows without a usable key", () => {
  assert.equal(sanitizeConnectionsBatch("x"), null);
  assert.equal(sanitizeConnectionsBatch(rows(CONNECTIONS_BATCH_MAX_ROWS + 1)), null);
  assert.equal(sanitizeConnectionsBatch([{ profileKey: "" }, ...rows(1)])?.length, 1);
});

test("sanitizeConnectionsBatch: re-normalizes the key, coerces junk fields to null and clamps long text", () => {
  const out = sanitizeConnectionsBatch([
    { profileKey: "https://WWW.linkedin.com/in/Jane/?x=1", firstName: 5, company: "x".repeat(2000) },
  ]);
  assert.equal(out?.[0].profileKey, "linkedin.com/in/jane");
  assert.equal(out?.[0].firstName, null);
  assert.equal(out?.[0].company?.length, 500);
});
