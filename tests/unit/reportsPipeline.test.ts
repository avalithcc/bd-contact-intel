/**
 * Unit tests for src/lib/reports/pipeline.ts — "Pipeline de empresas"
 * (owner-reporting decision 7: ignores the period filter — a current
 * snapshot of `company.relationship_stage`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPipelineRows } from "@/lib/reports/pipeline";

test("buildPipelineRows returns the 5 known stages in the mockup's fixed order, even with zero rows", () => {
  const rows = buildPipelineRows([]);
  assert.deepEqual(
    rows.map((r) => r.stage),
    ["prospect", "qualified", "proposal_sent", "won", "lost"],
  );
  assert.ok(rows.every((r) => r.count === 0 && r.pct === 0));
});

test("buildPipelineRows computes each stage's percentage of the total company count", () => {
  const rows = buildPipelineRows([
    { stage: "prospect", count: 13423 },
    { stage: "qualified", count: 831 },
    { stage: "won", count: 2 },
  ]);
  const total = 13423 + 831 + 2;
  assert.equal(rows.find((r) => r.stage === "prospect")!.pct, Math.round((13423 / total) * 100));
  assert.equal(rows.find((r) => r.stage === "qualified")!.pct, Math.round((831 / total) * 100));
  assert.equal(rows.find((r) => r.stage === "proposal_sent")!.count, 0);
});

test("buildPipelineRows a null/unknown stage is folded into a separate 'unknown' bucket, not dropped silently", () => {
  const rows = buildPipelineRows([{ stage: null, count: 5 }]);
  assert.equal(rows.find((r) => r.stage === "unknown")?.count ?? 0, 5);
});

test("buildPipelineRows never divides by zero", () => {
  const rows = buildPipelineRows([]);
  assert.ok(rows.every((r) => Number.isFinite(r.pct)));
});
