/**
 * DB-backed equivalence test: the `/companies` list's contact count and the
 * company record's contact count are two implementations of one concept (the
 * list: `getCompanyAliasRows` + `companyContactCountsQuery` + the fold; the
 * record: `companyContactsCondition`, aliases resolved inside the statement).
 * The unit suite can only compare their SQL TEXT; it cannot prove the
 * `NOT EXISTS` binds to `company_alias` inside the record's `union` branch or
 * that the right row is correlated. Production holds zero alias/company
 * collisions, so production data cannot catch a placement drift either — this
 * test builds the collision itself and runs both real queries.
 *
 * Opt-in and fail-closed: `npm run test:db`, with DATABASE_URL pointing at a
 * local database whose name ends in `_e2e`. The guard runs BEFORE `@/db` is
 * imported (which would connect), so a production URL fails here without a
 * single connection being opened. Not part of `npm run test:unit`.
 *
 * Leaves the database as it found it: everything runs in one transaction that
 * is rolled back by a sentinel throw, whether the assertions pass or fail.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const ROLLBACK = new Error("rollback");

async function inRolledBackTransaction(body: (tx: Tx) => Promise<void>): Promise<void> {
  const { db } = await import("@/db");
  try {
    await db.transaction(async (tx) => {
      await body(tx as unknown as Tx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
}

type Tx = Pick<typeof import("@/db").db, "select" | "insert" | "update">;

async function seedAndCount(tx: Tx) {
  const { company, companyAlias, person, targetCompany } = await import("@/db/schema");
  const { getCompanyAliasRows } = await import("@/lib/companies/aliasResolutionDb");
  const { companyContactCountsQuery, companyContactsCondition, countContactsByCompany } = await import("@/lib/companies/contactCounts");
  const { sql } = await import("drizzle-orm");

  const people = async (companyKey: string, n: number) =>
    tx.insert(person).values(Array.from({ length: n }, () => ({ companyKey }))).returning({ id: person.id });

  const recordCount = async (key: string) => {
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(person).where(companyContactsCondition(key));
    return row?.n ?? 0;
  };
  const listCounts = (keys: string[]) =>
    countContactsByCompany(keys, {
      readAliasRows: (k) => getCompanyAliasRows(k, tx),
      readCounts: (k) => companyContactCountsQuery(tx, k),
    });

  // `bd_contact_intel_e2e` was found (2026-10-09) still carrying the pre-0039
  // FK `company_alias.company_key -> target_company`, so an alias target needs a
  // target_company row there. Harmless on a migrated schema (rolled back with
  // everything else), and it keeps this test independent of which side of 0039
  // the scratch database is on.
  const asAliasTarget = (companyKey: string) =>
    tx.insert(targetCompany).values({ companyKey, displayName: companyKey, ats: "lever", config: {} });

  return { company, companyAlias, people, recordCount, listCounts, asAliasTarget };
}

test("collision: an alias whose key is a live company belongs to nobody, on the list and on the record", async () => {
  await inRolledBackTransaction(async (tx) => {
    const t = await seedAndCount(tx);
    await tx.insert(t.company).values([
      { companyKey: "zz-eq-x", displayName: "X" },
      { companyKey: "zz-eq-y", displayName: "Y" },
    ]);
    await t.asAliasTarget("zz-eq-y");
    await tx.insert(t.companyAlias).values({ aliasKey: "zz-eq-x", companyKey: "zz-eq-y" });
    await t.people("zz-eq-x", 2);
    await t.people("zz-eq-y", 3);

    // X keeps its own people; Y must not count them.
    assert.equal(await t.recordCount("zz-eq-x"), 2);
    assert.equal(await t.recordCount("zz-eq-y"), 3);
    // Same answer on the list whether X is on the page or not (page-independent).
    for (const page of [["zz-eq-x", "zz-eq-y"], ["zz-eq-y"], ["zz-eq-x"]]) {
      const counts = await t.listCounts(page);
      if (page.includes("zz-eq-x")) assert.equal(counts.get("zz-eq-x"), 2, `X on page ${page}`);
      if (page.includes("zz-eq-y")) assert.equal(counts.get("zz-eq-y"), 3, `Y on page ${page}`);
    }
  });
});

test("no collision: a real alias counts toward its company on both paths, merged-away people never", async () => {
  await inRolledBackTransaction(async (tx) => {
    const t = await seedAndCount(tx);
    const { person } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await tx.insert(t.company).values({ companyKey: "zz-eq-a", displayName: "A" });
    await t.asAliasTarget("zz-eq-a");
    await tx.insert(t.companyAlias).values({ aliasKey: "zz-eq-a1", companyKey: "zz-eq-a" });
    const own = await t.people("zz-eq-a", 2);
    await t.people("zz-eq-a1", 4);
    // One merged-away person on each key: counted by neither path.
    const [mergedOwn] = await t.people("zz-eq-a", 1);
    const [mergedAlias] = await t.people("zz-eq-a1", 1);
    for (const m of [mergedOwn, mergedAlias]) {
      await tx.update(person).set({ mergedIntoId: own[0]!.id }).where(eq(person.id, m!.id));
    }

    assert.equal(await t.recordCount("zz-eq-a"), 6);
    assert.equal((await t.listCounts(["zz-eq-a"])).get("zz-eq-a"), 6);
  });
});

test("the transaction is rolled back: no test row survives", async () => {
  const { db } = await import("@/db");
  const { company } = await import("@/db/schema");
  const { like, sql } = await import("drizzle-orm");
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(company).where(like(company.companyKey, "zz-eq-%"));
  assert.equal(row?.n, 0);
});
