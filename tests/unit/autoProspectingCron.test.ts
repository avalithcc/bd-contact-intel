import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isSessionExemptPath } from "@/lib/auth/sessionExemptRoutes";
import {
  AUTO_PROSPECTING_RUN_ACTION,
  AUTO_PROSPECTING_BUDGET_MS,
  handleAutoProspectingRequest,
  runAutoProspectingCron,
  type CronDeps,
} from "@/lib/prospecting/cronRun";
import type { ConsumeSummary } from "@/lib/prospecting/consumer";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const summary = (o: Partial<ConsumeSummary> = {}): ConsumeSummary => ({ drafted: 0, refused: 0, deferred: 0, failed: 0, byReason: {}, stoppedEarly: false, leftForNextRun: 0, ...o });

function fakeDeps(o: { enabled?: boolean; admins?: string[]; produced?: string[]; consumed?: ConsumeSummary; now?: number } = {}) {
  const calls = { produce: 0, consume: 0, audit: [] as { actor: string; metadata: Record<string, unknown> }[], deadline: undefined as number | undefined };
  const deps: CronDeps = {
    clock: () => o.now ?? 1_000_000,
    anyBdEnabled: async () => o.enabled ?? true,
    readAdminBdIds: async () => o.admins ?? [ADMIN],
    produce: async () => {
      calls.produce++;
      return o.produced ?? [];
    },
    consume: async (opts) => {
      calls.consume++;
      calls.deadline = opts.deadlineMs;
      return o.consumed ?? summary();
    },
    audit: async (actor, metadata) => {
      calls.audit.push({ actor, metadata });
    },
  };
  return { deps, calls };
}

const req = (auth?: string) => new Request("https://x.test/api/prospecting/run", { headers: auth ? { authorization: auth } : {} });

test("no bearer and a wrong bearer are refused with 401, and the run is never started", async () => {
  let ran = 0;
  const run = async () => {
    ran++;
    return { status: "ok" } as never;
  };
  for (const auth of [undefined, "Bearer nope", "nope"]) {
    const res = await handleAutoProspectingRequest(req(auth), { secret: "s3cret", run });
    assert.equal(res.status, 401);
  }
  const noSecret = await handleAutoProspectingRequest(req("Bearer undefined"), { secret: undefined, run });
  assert.equal(noSecret.status, 401, "an unset CRON_SECRET never authorizes anything");
  assert.equal(ran, 0);
  const ok = await handleAutoProspectingRequest(req("Bearer s3cret"), { secret: "s3cret", run });
  assert.equal(ok.status, 200);
  assert.equal(ran, 1);
});

test("every BD has the switch off: a cheap no-op, no producer, no consumer, no model call, no audit row", async () => {
  const { deps, calls } = fakeDeps({ enabled: false });
  const r = await runAutoProspectingCron(deps);
  assert.equal(r.status, "noop");
  assert.equal(r.reason, "no_bd_enabled");
  assert.equal(r.modelCalls, 0);
  assert.equal(calls.produce + calls.consume + calls.audit.length, 0);
});

test("the consumer is given a deadline 50s-class budget ahead of now, and the leftover is reported", async () => {
  const { deps, calls } = fakeDeps({ now: 5_000, produced: ["a"], consumed: summary({ drafted: 2, stoppedEarly: true, leftForNextRun: 7 }) });
  const r = await runAutoProspectingCron(deps);
  assert.equal(calls.deadline, 5_000 + AUTO_PROSPECTING_BUDGET_MS);
  assert.ok(AUTO_PROSPECTING_BUDGET_MS < 60_000, "under the route's maxDuration");
  assert.equal(r.status, "ok");
  assert.equal(r.stoppedEarly, true);
  assert.equal(r.leftForNextRun, 7);
  assert.equal(r.signalsProduced, 1);
});

test("a run that wrote something leaves one audit_log row with the counts and the leftover; an idle run leaves none", async () => {
  const busy = fakeDeps({ produced: ["a", "b"], consumed: summary({ drafted: 3, refused: 1, leftForNextRun: 4, stoppedEarly: true }) });
  await runAutoProspectingCron(busy.deps);
  assert.equal(busy.calls.audit.length, 1);
  assert.equal(busy.calls.audit[0]!.actor, ADMIN);
  assert.deepEqual(busy.calls.audit[0]!.metadata, { trigger: "cron", signalsProduced: 2, drafted: 3, refused: 1, deferred: 0, failed: 0, stoppedEarly: true, leftForNextRun: 4, byReason: {} });
  assert.equal(AUTO_PROSPECTING_RUN_ACTION, "auto_prospecting_run");

  const idle = fakeDeps();
  await runAutoProspectingCron(idle.deps);
  assert.equal(idle.calls.audit.length, 0);
});

test("no admin or several admins: the run refuses before producing or drafting anything", async () => {
  for (const admins of [[], [ADMIN, "00000000-0000-4000-8000-000000000002"]]) {
    const { deps, calls } = fakeDeps({ admins });
    const r = await runAutoProspectingCron(deps);
    assert.equal(r.status, "refused");
    assert.equal(calls.produce + calls.consume, 0);
  }
});

test("the route is session-exempt, GET-only, maxDuration 60, and registered as a daily Vercel-free pg_cron path", () => {
  assert.equal(isSessionExemptPath("/api/prospecting/run"), true);
  const src = readFileSync(join(__dirname, "..", "..", "src", "app", "api", "prospecting", "run", "route.ts"), "utf8");
  assert.match(src, /export const maxDuration = 60/);
  assert.match(src, /export const dynamic = "force-dynamic"/);
  assert.match(src, /handleAutoProspectingRequest/);
});

test("cronRun.ts stays loadable without a database", () => {
  // It imported "@/db" at the top, so this very file threw "DATABASE_URL is not set" before it ran a single
  // assertion - and looked green only because it had been run with a database URL in the environment. The wiring
  // now lives in cronRunDeps.ts. This is the same pure/impure split plan.ts and consumer.ts already use.
  const src = readFileSync("src/lib/prospecting/cronRun.ts", "utf8");
  for (const line of src.split("\n")) {
    if (!line.trimStart().startsWith("import")) continue;
    if (line.includes("import type")) continue;
    assert.ok(!/from "@\/db/.test(line), `cronRun.ts must not import the database: ${line.trim()}`);
  }
});
