/**
 * getHiringMatchIndex is built from ONE aggregated statement (counts in Postgres). The invariant worth pinning: it is
 * equal, key by key and field by field, to the index derived from resolveHiringCompanies (the per-posting detail read
 * it replaced), for every filter combination. Seeded so the counts differ per company: startup vs not, offshore-heavy
 * vs not, a company with TWO aliases (a join-based count would double it), and an offshore-heavy company that a
 * `market` filter would make look balanced if hideOffshore were applied over the filtered postings.
 * Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local `_e2e` database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const k = (n: string) => `zz-${run}-${n}`;
const KEYS = ["startup", "heavy", "balanced", "heavyus", "notstartup", "stale"].map(k);
const ALIASES = [`zz-${run}-startup-a1`, `zz-${run}-startup-a2`, `zz-${run}-balanced-a1`];

type P = { market: string; offshore?: boolean; miami?: boolean; isIt?: boolean; ageDays?: number; closed?: boolean };
const COMPANIES: Record<string, { startup: boolean | null; postings: P[] }> = {
  startup: { startup: true, postings: [{ market: "us" }, { market: "us", miami: true }, { market: "latam" }] },
  heavy: { startup: null, postings: [{ market: "other", offshore: true }, { market: "other", offshore: true }, { market: "us" }] },
  balanced: { startup: false, postings: [{ market: "other", offshore: true }, { market: "latam" }, { market: "latam" }, { market: "us" }] },
  // Offshore-heavy over ALL postings (2 offshore vs 0 latam) yet one "us" posting: market=us must not rescue it.
  heavyus: { startup: true, postings: [{ market: "other", offshore: true }, { market: "other", offshore: true }, { market: "us" }] },
  notstartup: { startup: false, postings: [{ market: "us" }, { market: "us", isIt: false }] },
  stale: { startup: true, postings: [{ market: "us", ageDays: 90 }, { market: "us", closed: true }] },
};

before(async () => {
  const { db } = await import("@/db");
  const { company, companyAlias, jobPosting, targetCompany } = await import("@/db/schema");
  for (const [name, c] of Object.entries(COMPANIES)) {
    const ck = k(name);
    await db.insert(company).values({ companyKey: ck, displayName: ck });
    await db.insert(targetCompany).values({ companyKey: ck, displayName: `Name ${name}`, ats: "lever", config: {}, isStartup: c.startup, startupReason: c.startup ? `reason ${name}` : null });
    let i = 0;
    for (const p of c.postings) {
      const at = new Date(Date.now() - (p.ageDays ?? 1) * 86_400_000);
      await db.insert(jobPosting).values({
        companyKey: ck, externalId: String(i++), title: "Engineer", location: p.offshore ? "Bangalore, India" : "Austin, TX", url: "https://example.test",
        isIt: p.isIt ?? true, market: p.market, isMiami: p.miami ?? false, isOffshoreHub: p.offshore ?? false,
        postedAt: at, firstSeen: at, closedAt: p.closed ? new Date() : null,
      });
    }
  }
  for (const a of ALIASES) {
    const owner = a.includes("startup") ? k("startup") : k("balanced");
    await db.insert(companyAlias).values({ aliasKey: a, companyKey: owner });
  }
});

after(async () => {
  const { db } = await import("@/db");
  const { company, companyAlias, jobPosting, targetCompany } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(companyAlias).where(inArray(companyAlias.aliasKey, ALIASES));
  await db.delete(jobPosting).where(inArray(jobPosting.companyKey, KEYS));
  await db.delete(targetCompany).where(inArray(targetCompany.companyKey, KEYS));
  await db.delete(company).where(inArray(company.companyKey, KEYS));
  await db.$client.end();
});

type Args = [market?: "us" | "latam", miamiOnly?: boolean, hideOffshore?: boolean, startupsOnly?: boolean];
const COMBOS: Record<string, Args> = {
  none: [undefined, undefined, undefined, undefined],
  market_us: ["us", undefined, undefined, undefined],
  market_latam: ["latam", undefined, undefined, undefined],
  miami: ["us", true, undefined, undefined],
  startups: [undefined, undefined, undefined, true],
  hideOffshore: [undefined, undefined, true, undefined],
  market_us_hideOffshore: ["us", undefined, true, undefined],
  everything: ["us", true, true, true],
};

// The reference: the index the way it was built before, from the per-posting detail read.
async function referenceIndex(...args: Args) {
  const { resolveHiringCompanies } = await import("@/lib/hiring/queries");
  const index = new Map<string, unknown>();
  for (const c of (await resolveHiringCompanies(...args)).values()) {
    const match = {
      companyKey: c.companyKey, displayName: c.displayName, openItCount: c.postings.length, offshoreItCount: c.offshoreItCount,
      latamItCount: c.latamItCount, isStartup: c.isStartup, startupReason: c.startupReason, offshoreHeavy: c.offshoreHeavy,
    };
    for (const key of c.matchKeys) index.set(key, match);
  }
  return index;
}

for (const [name, args] of Object.entries(COMBOS)) {
  test(`aggregated hiring match index equals the per-posting-derived index on every key and field (${name})`, async () => {
    const { getHiringMatchIndex } = await import("@/lib/hiring/queries");
    const got = await getHiringMatchIndex(...args);
    const want = await referenceIndex(...args);
    assert.deepEqual([...got.keys()].sort(), [...want.keys()].sort());
    for (const [key, match] of got) assert.deepEqual(match, want.get(key), key);
  });
}

test("the seed makes the comparison meaningful: counts, startup flags, offshore-heavy and alias keys all differ per company", async () => {
  const { getHiringMatchIndex } = await import("@/lib/hiring/queries");
  const all = await getHiringMatchIndex(undefined, undefined, undefined, undefined);
  const m = (n: string) => all.get(k(n))!;
  assert.equal(m("startup").openItCount, 3);
  assert.equal(all.get(`zz-${run}-startup-a2`), m("startup"), "both aliases resolve, and the count is not multiplied by them");
  assert.equal(m("balanced").openItCount, 4);
  assert.equal(m("heavy").offshoreHeavy, true);
  assert.equal(m("balanced").offshoreHeavy, false);
  assert.equal(m("startup").isStartup, true);
  assert.equal(m("notstartup").isStartup, false);
  assert.equal(m("notstartup").openItCount, 1, "a non-IT posting is not counted");
  assert.equal(all.has(k("stale")), false, "a stale or closed posting does not make a company hiring");
  // hideOffshore counts over ALL postings: market=us does not rescue an offshore-heavy company.
  const hidden = await getHiringMatchIndex("us", undefined, true, undefined);
  assert.equal(hidden.has(k("heavyus")), false);
  assert.equal(hidden.has(k("balanced")), true);
});

test("local timing: aggregated index vs the two-statement per-posting read", async () => {
  const { getHiringMatchIndex } = await import("@/lib/hiring/queries");
  const med = async (fn: () => Promise<unknown>) => {
    const ms: number[] = [];
    for (let i = 0; i < 7; i++) { const t = performance.now(); await fn(); ms.push(performance.now() - t); }
    return ms.sort((a, b) => a - b)[3]!.toFixed(1);
  };
  console.log(`timing (local, tiny data) aggregated=${await med(() => getHiringMatchIndex(undefined, undefined, undefined, undefined))}ms reference=${await med(() => referenceIndex())}ms`);
});

// Absolute assertions on the new index alone: both sides of the equivalence comparison share openItPostingFilters, so a
// mutation of one of its conditions would change both sides and pass unnoticed there.
test("startupsOnly keeps only classified startups: unclassified (null) and confirmed non-startups are absent", async () => {
  const { getHiringMatchIndex } = await import("@/lib/hiring/queries");
  const idx = await getHiringMatchIndex(undefined, undefined, undefined, true);
  assert.equal(idx.has(k("startup")), true);
  assert.equal(idx.has(k("heavyus")), true);
  assert.equal(idx.has(k("heavy")), false, "is_startup NULL is excluded");
  assert.equal(idx.has(k("balanced")), false);
  assert.equal(idx.has(k("notstartup")), false);
  assert.equal(idx.get(k("startup"))!.openItCount, 3, "the startup filter is on the company, so its postings are all counted");
});

test("miamiOnly counts only the Miami posting: the startup company drops from 3 postings to 1 and everyone without one is absent", async () => {
  const { getHiringMatchIndex } = await import("@/lib/hiring/queries");
  const idx = await getHiringMatchIndex("us", true, undefined, undefined);
  assert.equal(idx.get(k("startup"))!.openItCount, 1);
  for (const n of ["heavy", "balanced", "heavyus", "notstartup"]) assert.equal(idx.has(k(n)), false, n);
});
