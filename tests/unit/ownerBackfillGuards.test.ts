/** Guards shared by the owner backfill script and the nightly cron. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OWNER_CRON_MAX_CHANGES,
  OWNER_SCRIPT_MAX_CHANGES,
  buildOwnerBackfillAuditMetadata,
  decideOwnerBackfillRun,
  resolveCronActor,
} from "@/lib/identity/ownerBackfillGuards";
import { planOwnerBackfill, type OwnerBackfillPlan } from "@/lib/identity/ownerBackfillPlan";

function planWith(n: number): OwnerBackfillPlan {
  return {
    changes: Array.from({ length: n }, (_, i) => ({ personId: `p${i}`, fromBdId: "a", toBdId: "b", basis: "last_touch" as const })),
    unchanged: 0,
    skippedManual: 0,
  };
}

test("cron cap is tight and below the script's", () => {
  assert.equal(OWNER_CRON_MAX_CHANGES, 25);
  assert.ok(OWNER_CRON_MAX_CHANGES < OWNER_SCRIPT_MAX_CHANGES);
});

test("decideOwnerBackfillRun: under, at and over the cap", () => {
  assert.equal(decideOwnerBackfillRun(planWith(0), 25), "nothing_to_do");
  assert.equal(decideOwnerBackfillRun(planWith(24), 25), "apply");
  assert.equal(decideOwnerBackfillRun(planWith(25), 25), "apply");
  assert.equal(decideOwnerBackfillRun(planWith(26), 25), "over_cap");
});

test("resolveCronActor: exactly one admin, otherwise refuse", () => {
  assert.deepEqual(resolveCronActor(["admin-1"]), { ok: true, bdId: "admin-1" });
  assert.deepEqual(resolveCronActor([]), { ok: false, reason: "no_admin" });
  assert.deepEqual(resolveCronActor(["a", "b"]), { ok: false, reason: "multiple_admins" });
});

test("cron and script share one plan: the cap never changes what is planned", () => {
  const input = {
    persons: [{ id: "p1", ownerBdId: "bd-a" }],
    connections: [{ personId: "p1", bdId: "bd-b", connectedOn: "1 Jan 2020", lastMessageAt: new Date("2025-01-01T00:00:00Z") }],
    touches: [],
    manualPersonIds: new Set<string>(),
  };
  const plan = planOwnerBackfill(input);
  assert.deepEqual(planOwnerBackfill(input), plan);
  assert.equal(decideOwnerBackfillRun(plan, OWNER_CRON_MAX_CHANGES), decideOwnerBackfillRun(plan, OWNER_SCRIPT_MAX_CHANGES));
});

test("audit metadata differs between a cron and a manual run only by trigger", () => {
  const plan = planWith(2);
  const cron = buildOwnerBackfillAuditMetadata(plan, plan.changes, "cron", "owner_backfill");
  const manual = buildOwnerBackfillAuditMetadata(plan, plan.changes, "manual", "owner_backfill");
  assert.equal(cron.trigger, "cron");
  assert.equal(manual.trigger, "manual");
  assert.deepEqual({ ...cron, trigger: "x" }, { ...manual, trigger: "x" });
  assert.equal(buildOwnerBackfillAuditMetadata(plan, plan.changes.slice(0, 1), "cron", "s").changedSinceRead, 1);
});
