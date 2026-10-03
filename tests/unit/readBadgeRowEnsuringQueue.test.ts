/**
 * F5: the shell builds today's follow-up queue the first time it sees a BD
 * on a given day, so the Seguimientos badge is not blank until she opens
 * /follow-ups. Pure orchestration, dependencies injected (no `@/db`).
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { readBadgeRowEnsuringQueue } from "@/lib/shell/readBadgeRowEnsuringQueue";

function harness(opts: { builtSequence: boolean[]; ensureThrows?: boolean }) {
  const calls = { read: 0, ensure: 0 };
  const seq = [...opts.builtSequence];
  return {
    calls,
    deps: {
      read: async () => {
        calls.read += 1;
        return { queue_built: seq.shift() ?? true };
      },
      ensure: async () => {
        calls.ensure += 1;
        if (opts.ensureThrows) throw new Error("boom");
      },
    },
  };
}

test("queue already built: one read, no build", async () => {
  const h = harness({ builtSequence: [true] });
  await readBadgeRowEnsuringQueue({ ...h.deps, attemptKey: "bd:2026-10-03", bdId: "bd", attempted: new Set() });
  assert.deepEqual(h.calls, { read: 1, ensure: 0 });
});

test("queue not built: builds once, then re-reads", async () => {
  const h = harness({ builtSequence: [false, true] });
  const row = await readBadgeRowEnsuringQueue({ ...h.deps, attemptKey: "bd:2026-10-03", bdId: "bd", attempted: new Set() });
  assert.deepEqual(h.calls, { read: 2, ensure: 1 });
  assert.equal(row.queue_built, true);
});

test("a BD with nothing due is not rebuilt on every navigation (memo per key)", async () => {
  const attempted = new Set<string>();
  const h = harness({ builtSequence: [false, false, false] });
  await readBadgeRowEnsuringQueue({ ...h.deps, attemptKey: "bd:2026-10-03", bdId: "bd", attempted });
  await readBadgeRowEnsuringQueue({ ...h.deps, attemptKey: "bd:2026-10-03", bdId: "bd", attempted });
  assert.equal(h.calls.ensure, 1);
  assert.equal(h.calls.read, 3, "2 reads on the first call (read, rebuild, re-read), 1 on the second");
});

test("a new day (new key) builds again", async () => {
  const attempted = new Set<string>();
  const h = harness({ builtSequence: [false, true, false, true] });
  await readBadgeRowEnsuringQueue({ ...h.deps, attemptKey: "bd:2026-10-03", bdId: "bd", attempted });
  await readBadgeRowEnsuringQueue({ ...h.deps, attemptKey: "bd:2026-10-04", bdId: "bd", attempted });
  assert.equal(h.calls.ensure, 2);
});

test("a failing build never breaks the page: the first read is returned", async () => {
  const h = harness({ builtSequence: [false] });
  const failing = { ...h.deps, ensure: async () => { h.calls.ensure += 1; throw new Error("boom"); } };
  const row = await readBadgeRowEnsuringQueue({ ...failing, attemptKey: "bd:2026-10-03", bdId: "bd", attempted: new Set() });
  assert.equal(row.queue_built, false);
  assert.equal(h.calls.ensure, 1);
  assert.equal(h.calls.read, 1, "no re-read after a failed build");
});

test("a swallowed build failure is logged with the bd id and the error, and nothing else", async () => {
  const spy = mock.method(console, "error", () => {});
  try {
    const h = harness({ builtSequence: [false] });
    const failing = { ...h.deps, ensure: async () => { throw new TypeError("connection reset"); } };
    await readBadgeRowEnsuringQueue({ ...failing, attemptKey: "bd-1:2026-10-03", bdId: "bd-1", attempted: new Set() });
    assert.equal(spy.mock.callCount(), 1);
    const line = String(spy.mock.calls[0]!.arguments.join(" "));
    assert.match(line, /bd-1/);
    assert.match(line, /TypeError/);
    assert.match(line, /connection reset/);
  } finally {
    spy.mock.restore();
  }
});
