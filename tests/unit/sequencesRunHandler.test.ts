import assert from "node:assert/strict";
import { test } from "node:test";
import { handleRunRequest, type RunLog } from "@/lib/sequences/runHandler";
import type { RunSummary } from "@/lib/sequences/runSequenceRelease";

const SECRET = "test-cron-secret";
const request = (authorization?: string) => new Request("https://example.test/api/sequences/run", { headers: authorization ? { authorization } : {} });

function harness(summary: RunSummary | Error = { released: 0, held: 0, deferred: 0, failed: 0 }) {
  const calls = { run: 0, logs: [] as { level: string; entry: unknown }[] };
  const log: RunLog = (level, entry) => calls.logs.push({ level, entry });
  const run = async () => {
    calls.run++;
    if (summary instanceof Error) throw summary;
    return summary;
  };
  return { calls, deps: (secret: string | undefined = SECRET) => ({ secret, run, log }) };
}

test("a missing Authorization header is a 401 and the runner never starts", async () => {
  const h = harness();
  const res = await handleRunRequest(request(), h.deps());
  assert.equal(res.status, 401);
  assert.equal(h.calls.run, 0);
});

test("a wrong bearer is a 401 and the runner never starts", async () => {
  const h = harness();
  const res = await handleRunRequest(request("Bearer not-the-secret"), h.deps());
  assert.equal(res.status, 401);
  assert.equal(h.calls.run, 0);
});

test("an unset CRON_SECRET is a 401 even for a request that sends 'Bearer undefined'", async () => {
  const h = harness();
  for (const header of ["Bearer undefined", "Bearer ", "Bearer"]) {
    const res = await handleRunRequest(request(header), h.deps(undefined));
    assert.equal(res.status, 401, header);
  }
  assert.equal(h.calls.run, 0);
});

test("a valid bearer runs the runner once and returns the whole summary", async () => {
  const summary: RunSummary = { released: 3, held: 1, deferred: 2, failed: 0 };
  const h = harness(summary);
  const res = await handleRunRequest(request(`Bearer ${SECRET}`), h.deps());
  assert.equal(res.status, 200);
  assert.equal(h.calls.run, 1);
  assert.deepEqual(await res.json(), summary);
});

// 13.3b. The runner only SIGNALS that the candidate cap cut something (`capped`) and that claims were lost (`lost`).
// A route that drops the summary turns both back into silent failure, so the log is the contract.
test("the log receives the whole RunSummary, capped and lost included", async () => {
  const summary: RunSummary = { released: 4, held: 501, deferred: 0, failed: 1, capped: true, lost: 2 };
  const h = harness(summary);
  await handleRunRequest(request(`Bearer ${SECRET}`), h.deps());
  const entries = h.calls.logs.map((l) => l.entry as Record<string, unknown>);
  const logged = entries.find((e) => e.event === "sequence_release_run");
  assert.ok(logged, "the run summary was never logged");
  for (const [key, value] of Object.entries(summary)) assert.equal(logged[key], value, `summary.${key} did not reach the log`);
  assert.equal(logged.capped, true);
  assert.equal(logged.lost, 2);
});

test("a capped run is logged at warn level so it is findable, a quiet run at info", async () => {
  const capped = harness({ released: 0, held: 501, deferred: 0, failed: 0, capped: true });
  await handleRunRequest(request(`Bearer ${SECRET}`), capped.deps());
  assert.equal(capped.calls.logs[0].level, "warn");
  const lost = harness({ released: 0, held: 0, deferred: 0, failed: 0, lost: 1 });
  await handleRunRequest(request(`Bearer ${SECRET}`), lost.deps());
  assert.equal(lost.calls.logs[0].level, "warn");
  const quiet = harness();
  await handleRunRequest(request(`Bearer ${SECRET}`), quiet.deps());
  assert.equal(quiet.calls.logs[0].level, "info");
});

test("a quiet run does not invent capped or lost keys", async () => {
  const h = harness();
  await handleRunRequest(request(`Bearer ${SECRET}`), h.deps());
  const logged = h.calls.logs[0].entry as Record<string, unknown>;
  assert.equal("capped" in logged, false);
  assert.equal("lost" in logged, false);
});

test("a runner that throws is a 500 with no message leaked, and the failure is logged", async () => {
  const h = harness(new Error("connection string postgres://secret@host"));
  const res = await handleRunRequest(request(`Bearer ${SECRET}`), h.deps());
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /secret@host/);
  const failure = h.calls.logs.find((l) => l.level === "error");
  assert.ok(failure);
  assert.match(JSON.stringify(failure.entry), /sequence_release_failed/);
});
