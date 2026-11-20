import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { handlePliegoRequest, PLIEGO_BUDGET_MS, runPliegoDownload, type PliegoCandidate, type PliegoRunDeps, type PliegoOutcome, type PliegoRunSummary } from "@/lib/tenders/pliegoRun";

const rows = (n: number): PliegoCandidate[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, processNumber: `P-${i}` }));
const pdf: PliegoOutcome = { kind: "ok", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), filename: "a.pdf" };

function ok(s: PliegoRunSummary) {
  assert.equal(s.status, "ok");
  if (s.status !== "ok") throw new Error("refused");
  return s;
}

function deps(over: Partial<PliegoRunDeps> & { candidates?: PliegoCandidate[]; total?: number; outcomes?: Record<string, PliegoOutcome | Error>; stepMs?: number } = {}) {
  let now = 0;
  const log = { fetched: [] as string[], stored: [] as string[], slept: [] as number[] };
  const d: PliegoRunDeps = {
    clock: () => now,
    sleep: async (ms) => {
      log.slept.push(ms);
    },
    prepare: async () => ({ ok: true }),
    selectDue: async () => ({ rows: over.candidates ?? rows(3), total: over.total ?? (over.candidates ?? rows(3)).length }),
    fetchOne: async (p) => {
      log.fetched.push(p);
      now += over.stepMs ?? 10_000;
      const o = over.outcomes?.[p] ?? pdf;
      if (o instanceof Error) throw o;
      return o;
    },
    store: async (c) => {
      log.stored.push(c.id);
      return "stored";
    },
    ...over,
  };
  return { d, log };
}

test("downloads each due tender, strictly in order, pausing between tenders and not after the last", async () => {
  const { d, log } = deps({ candidates: rows(2) });
  const s = ok(await runPliegoDownload(d));
  assert.deepEqual(log.fetched, ["P-0", "P-1"]);
  assert.equal(log.slept.length, 1);
  assert.deepEqual(s, { status: "ok", attempted: 2, downloaded: 2, skipped: 0, notFound: 0, failed: 0, stoppedEarly: false, leftForNextRun: 0 });
});

test("stops STARTING a tender once the budget has passed and reports what it left", async () => {
  const { d, log } = deps({ candidates: rows(10) });
  const s = ok(await runPliegoDownload(d));
  assert.ok(s.stoppedEarly);
  assert.equal(s.attempted, Math.ceil(PLIEGO_BUDGET_MS / 10_000));
  assert.equal(s.leftForNextRun, 10 - s.attempted);
  assert.equal(log.fetched.length, s.attempted);
});

test("a tender that already has a document by store time is counted skipped, not downloaded", async () => {
  const { d } = deps({ candidates: rows(2), store: async (c) => (c.id === "t0" ? "skipped" : "stored") });
  const s = ok(await runPliegoDownload(d));
  assert.equal(s.skipped, 1);
  assert.equal(s.downloaded, 1);
});

test("not found and missing pliego count as notFound; non-pdf, oversized, errors and throws count as failed; none fails the run", async () => {
  const { d, log } = deps({
    candidates: rows(6),
    stepMs: 1_000,
    outcomes: { "P-0": { kind: "not_found" }, "P-1": { kind: "no_document" }, "P-2": { kind: "not_pdf" }, "P-3": { kind: "too_large" }, "P-4": { kind: "error", message: "x" }, "P-5": new Error("boom") },
  });
  const s = ok(await runPliegoDownload(d));
  assert.equal(s.notFound, 2);
  assert.equal(s.failed, 4);
  assert.equal(s.downloaded, 0);
  assert.deepEqual(log.stored, [], "nothing is stored for a refused body");
});

test("a store that throws is that tender's failure and the run goes on", async () => {
  const { d } = deps({ candidates: rows(2), store: async (c) => { if (c.id === "t0") throw new Error("db"); return "stored"; } });
  const s = ok(await runPliegoDownload(d));
  assert.equal(s.failed, 1);
  assert.equal(s.downloaded, 1);
});

test("refuses when the uploader cannot be resolved, before selecting or fetching anything", async () => {
  const { d, log } = deps({ prepare: async () => ({ ok: false, reason: "multiple_admins" }) });
  const s = await runPliegoDownload(d);
  assert.deepEqual(s, { status: "refused", reason: "multiple_admins" });
  assert.equal(log.fetched.length, 0);
});

test("the same deps and input twice give the same summary (the planner does not consume its input)", async () => {
  const candidates = rows(3);
  const a = await runPliegoDownload(deps({ candidates }).d);
  const b = await runPliegoDownload(deps({ candidates }).d);
  assert.deepEqual(a, b);
  assert.deepEqual(candidates, rows(3));
});

test("bearer first: a wrong or missing token gets 401 and the run is never called; a refused run is a 500", async () => {
  let ran = 0;
  const run = async () => {
    ran++;
    return { status: "ok", attempted: 0, downloaded: 0, skipped: 0, notFound: 0, failed: 0, stoppedEarly: false, leftForNextRun: 0 } as const;
  };
  const req = (auth?: string) => new Request("http://x/api/tenders/pliegos", { headers: auth ? { authorization: auth } : {} });
  assert.equal((await handlePliegoRequest(req(), { secret: "s", run })).status, 401);
  assert.equal((await handlePliegoRequest(req("Bearer nope"), { secret: "s", run })).status, 401);
  assert.equal((await handlePliegoRequest(req("Bearer undefined"), { secret: undefined, run })).status, 401);
  assert.equal(ran, 0);
  assert.equal((await handlePliegoRequest(req("Bearer s"), { secret: "s", run })).status, 200);
  const refused = await handlePliegoRequest(req("Bearer s"), { secret: "s", run: async () => ({ status: "refused", reason: "no_admin" }) });
  assert.equal(refused.status, 500);
});

test("nothing in the new code path can reach the analysis", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const f of ["pliegoRun.ts", "pliegoFetch.ts", "pliegoRunDeps.ts"]) {
    const src = strip(readFileSync(new URL(`../../src/lib/tenders/${f}`, import.meta.url), "utf8"));
    assert.doesNotMatch(src, /analy[sz]/i, f);
    assert.doesNotMatch(src, /gateway|generateText|generateObject|@ai-sdk|tenderAnalysis/i, f);
  }
  const route = strip(readFileSync(new URL("../../src/app/api/tenders/pliegos/route.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(route, /analy[sz]/i);
  assert.match(route, /maxDuration = 60/);
  assert.doesNotMatch(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"), /tenders\/pliegos/, "no cron schedule yet");
});
