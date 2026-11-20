import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fetchPortalProcess } from "@/lib/tenders/portalFetch";
import {
  PORTAL_BUDGET_MS,
  PORTAL_MAX_PER_RUN,
  handlePortalRequest,
  runPortalFetch,
  type PortalCandidate,
  type PortalOutcome,
  type PortalRunDeps,
} from "@/lib/tenders/portalRun";

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const citizen = read("comprar-citizen-view.html");
const hit = read("comprar-search-hit.html");
const empty = read("comprar-search-empty.html");
const withViewState = (html: string, v: string) => html.replace(/(name="__VIEWSTATE"[^>]*value=")[^"]*/, `$1${v}`);

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  form: URLSearchParams | null;
}

/** A stand-in for the portal that answers with the REAL saved pages and records every request. */
function fakePortal(opts: { searchResult?: string; citizenHtml?: string; failAt?: number } = {}) {
  const calls: Call[] = [];
  const page = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init });
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const form = typeof init?.body === "string" ? new URLSearchParams(init.body) : null;
    calls.push({ method: init?.method ?? "GET", url, headers, form });
    if (opts.failAt === calls.length) throw new Error("socket hang up");
    if (url.includes("VistaPreviaPliegoCiudadano")) return page(opts.citizenHtml ?? citizen);
    if (!form) return page(withViewState(hit, "STATE-1"), { headers: { "set-cookie": "ASP.NET_SessionId=abc; path=/; HttpOnly" } });
    if (form.get("__EVENTTARGET") === "ctl00$CPH1$btnListarPliegoNumero") return page(withViewState(opts.searchResult ?? hit, "STATE-2"));
    return new Response(null, { status: 302, headers: { location: "/PLIEGO/VistaPreviaPliegoCiudadano.aspx?qs=abc123" } });
  }) as typeof fetch;
  return { impl, calls };
}

test("three requests, row target read from the page, state taken from the previous response", async () => {
  const { impl, calls } = fakePortal();
  const out = await fetchPortalProcess("487-0018-LPR26", { fetchImpl: impl });
  assert.equal(out.kind, "ok");
  if (out.kind !== "ok") return;
  assert.equal(out.portalUrl, "https://comprar.gob.ar/PLIEGO/VistaPreviaPliegoCiudadano.aspx?qs=abc123");
  assert.equal(out.fields.contractDuration, "12 Meses");
  const [search, list, open] = calls.filter((c) => !c.url.includes("VistaPrevia"));
  assert.equal(search?.method, "GET");
  assert.equal(list?.form?.get("ctl00$CPH1$txtNumeroProceso"), "487-0018-LPR26");
  assert.equal(list?.form?.get("__VIEWSTATE"), "STATE-1");
  assert.equal(open?.form?.get("__EVENTTARGET"), "ctl00$CPH1$GridListaPliegos$ctl02$lnkNumeroProceso");
  assert.equal(open?.form?.get("__VIEWSTATE"), "STATE-2");
});

test("polite and anonymous: generic User-Agent, the session cookie only, nothing identifying", async () => {
  const { impl, calls } = fakePortal();
  await fetchPortalProcess("487-0018-LPR26", { fetchImpl: impl });
  for (const c of calls) {
    assert.equal(c.headers["User-Agent"], "tender-monitor/1.0");
    const names = Object.keys(c.headers).map((h) => h.toLowerCase());
    assert.deepEqual(names.filter((n) => !["user-agent", "content-type", "referer", "cookie", "accept"].includes(n)), []);
    assert.ok(!/avalith|authorization/i.test(JSON.stringify(c.headers)));
  }
  assert.match(calls[1]?.headers.Cookie ?? "", /ASP\.NET_SessionId=abc/);
});

test("a process the search does not find is not_found, not an error", async () => {
  const { impl, calls } = fakePortal({ searchResult: empty });
  assert.deepEqual(await fetchPortalProcess("1-1-X", { fetchImpl: impl }), { kind: "not_found" });
  assert.equal(calls.length, 2);
});

test("network failure, a foreign page and a hung request are error outcomes, never throws", async () => {
  const net = await fetchPortalProcess("1-1-X", { fetchImpl: fakePortal({ failAt: 2 }).impl });
  assert.equal(net.kind, "error");
  const foreign = await fetchPortalProcess("1-1-X", { fetchImpl: fakePortal({ citizenHtml: "<html>Servicio no disponible</html>" }).impl });
  assert.deepEqual(foreign, { kind: "error", message: "not_citizen_view" });
  const hung = (async (_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as typeof fetch;
  const t = await fetchPortalProcess("1-1-X", { fetchImpl: hung, timeoutMs: 20 });
  assert.equal(t.kind, "error");
});

test("it never follows a redirect off the portal", async () => {
  const bad = (async (_u: unknown, init?: RequestInit) => (init?.body ? new Response(null, { status: 302, headers: { location: "https://evil.example/x" } }) : new Response(withViewState(hit, "S")))) as typeof fetch;
  const out = await fetchPortalProcess("1-1-X", { fetchImpl: bad });
  assert.equal(out.kind, "error");
});

// ---- the run ----

const cands = (n: number): PortalCandidate[] => Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, processNumber: `P-${i}`, openingAt: new Date("2026-12-01T14:00:00Z") }));
const ok: PortalOutcome = { kind: "ok", portalUrl: "u", fields: { objeto: "o", currency: null, contractDuration: null, offerValidity: null, acceptsExtension: null, questionsUntil: null, openingAt: null, guaranteeOffer: null, guaranteeContract: null, guaranteeChallenge: null, circularCount: 0 } };

function deps(over: Partial<PortalRunDeps> & { rows?: PortalCandidate[]; total?: number; step?: number } = {}) {
  let now = 1_000;
  const saved: [string, string][] = [];
  const sleeps: number[] = [];
  const d: PortalRunDeps = {
    clock: () => now,
    sleep: async (ms) => void sleeps.push(ms),
    selectDue: async (limit) => ({ rows: (over.rows ?? cands(3)).slice(0, limit), total: over.total ?? (over.rows ?? cands(3)).length }),
    fetchOne: async () => {
      now += over.step ?? 0;
      return ok;
    },
    save: async (c, o) => void saved.push([c.id, o.kind]),
    applyOpening: async () => true,
    ...over,
  };
  return { d, saved, sleeps };
}

test("every due tender is fetched and saved, with a pause between them and none after the last", async () => {
  const { d, saved, sleeps } = deps();
  const r = await runPortalFetch(d);
  assert.deepEqual(r, { status: "ok", attempted: 3, fetched: 3, notFound: 0, failed: 0, openingMoved: 0, stoppedEarly: false, leftForNextRun: 0 });
  assert.equal(saved.length, 3);
  assert.equal(sleeps.length, 2);
});

test("past the wall-clock budget no new tender is STARTED, and what is left is reported", async () => {
  const { d, saved } = deps({ rows: cands(10), step: PORTAL_BUDGET_MS / 2 + 1 });
  const r = await runPortalFetch(d);
  assert.equal(r.status, "ok");
  assert.equal(r.attempted, 2);
  assert.equal(r.stoppedEarly, true);
  assert.equal(r.leftForNextRun, 8);
  assert.equal(saved.length, 2);
});

test("leftForNextRun counts what the query found beyond the cap too", async () => {
  const { d } = deps({ rows: cands(PORTAL_MAX_PER_RUN), total: PORTAL_MAX_PER_RUN + 25 });
  const r = await runPortalFetch(d);
  assert.equal(r.attempted, PORTAL_MAX_PER_RUN);
  assert.equal(r.leftForNextRun, 25);
  assert.equal(r.stoppedEarly, false);
});

test("one tender's failure never fails the run: it is recorded and the next one still runs", async () => {
  let n = 0;
  const { d, saved } = deps({
    fetchOne: async () => {
      n++;
      if (n === 1) throw new Error("boom");
      return n === 2 ? ({ kind: "error", message: "timeout" } as PortalOutcome) : n === 3 ? ({ kind: "not_found" } as PortalOutcome) : ok;
    },
    rows: cands(4),
  });
  const r = await runPortalFetch(d);
  assert.deepEqual(r, { status: "ok", attempted: 4, fetched: 1, notFound: 1, failed: 2, openingMoved: 0, stoppedEarly: false, leftForNextRun: 0 });
  assert.deepEqual(saved.map(([, k]) => k), ["error", "error", "not_found", "ok"]);
});

test("a save that throws counts as that tender's failure, not the run's", async () => {
  const { d } = deps({ save: async () => { throw new Error("db down"); } });
  const r = await runPortalFetch(d);
  assert.equal(r.failed, 3);
});

test("auth first: a wrong bearer gets 401 and the run is never called", async () => {
  let called = false;
  const run = async () => (called = true, await runPortalFetch(deps().d));
  const res = await handlePortalRequest(new Request("http://x", { headers: { authorization: "Bearer wrong" } }), { secret: "s", enabled: true, run });
  assert.equal(res.status, 401);
  assert.equal(called, false);
  const none = await handlePortalRequest(new Request("http://x"), { secret: undefined, enabled: true, run });
  assert.equal(none.status, 401);
  const good = await handlePortalRequest(new Request("http://x", { headers: { authorization: "Bearer s" } }), { secret: "s", enabled: true, run });
  assert.equal(good.status, 200);
});

test("the planner-style inputs are not mutated by a run", async () => {
  const rows = cands(3);
  const before = JSON.stringify(rows);
  await runPortalFetch(deps({ rows }).d);
  await runPortalFetch(deps({ rows }).d);
  assert.equal(JSON.stringify(rows), before);
});

test("the route is exempt from the session gate (it authenticates with the bearer itself)", async () => {
  const { isSessionExemptPath } = await import("@/lib/auth/sessionExemptRoutes");
  assert.equal(isSessionExemptPath("/api/tenders/portal"), true);
});
