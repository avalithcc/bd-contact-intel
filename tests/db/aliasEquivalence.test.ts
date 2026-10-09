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

/**
 * FAILS LOUDLY when the scratch database is behind migration 0039. There,
 * `company_alias.company_key` references `target_company` instead of `company`,
 * so the "alias key is a live company" collision this test exists to build would
 * be a different world from production's. Bridging the gap (inserting a
 * target_company row to satisfy the old FK) would make the test pass on a schema
 * production cannot have and hide that the scratch database is stale, so the
 * stale state is made visible instead. `bd_contact_intel_e2e` was built by
 * `db:push` from an older schema (0 rows in drizzle.__drizzle_migrations), so
 * `db:migrate` cannot bring it forward; rebuild it per tests/e2e/README.md.
 */
async function assertAliasFkPointsAtCompany(tx: Tx): Promise<void> {
  const { sql } = await import("drizzle-orm");
  const rows = (await tx.execute<{ target: string }>(
    sql`select c.confrelid::regclass::text as target
        from pg_constraint c
        where c.conrelid = 'public.company_alias'::regclass and c.contype = 'f'
          and c.confrelid in ('public.company'::regclass, 'public.target_company'::regclass)`,
  ));
  const targets = rows.map((r) => r.target);
  assert.ok(
    targets.includes("company") && !targets.includes("target_company"),
    `the scratch database is behind migration 0039 (company_alias.company_key references ${targets.join(", ") || "nothing"}, production references company); rebuild it, see tests/e2e/README.md`,
  );
}

async function inRolledBackTransaction(body: (tx: Tx) => Promise<void>): Promise<void> {
  const { db } = await import("@/db");
  try {
    await db.transaction(async (tx) => {
      await assertAliasFkPointsAtCompany(tx as unknown as Tx);
      await body(tx as unknown as Tx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
}

type Tx = Pick<typeof import("@/db").db, "select" | "insert" | "update" | "execute">;

async function seedAndCount(tx: Tx) {
  const { company, companyAlias, person } = await import("@/db/schema");
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

  return { company, companyAlias, people, recordCount, listCounts };
}

test("collision: an alias whose key is a live company belongs to nobody, on the list and on the record", async () => {
  await inRolledBackTransaction(async (tx) => {
    const t = await seedAndCount(tx);
    await tx.insert(t.company).values([
      { companyKey: "zz-eq-x", displayName: "X" },
      { companyKey: "zz-eq-y", displayName: "Y" },
    ]);
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

test("the transaction is rolled back: no test row survives in any table the tests write to", async () => {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const [row] = await db.execute<{ company: number; person: number; alias: number; target: number }>(sql`
    select
      (select count(*)::int from company where company_key like 'zz-eq-%') as company,
      (select count(*)::int from person where company_key like 'zz-eq-%') as person,
      (select count(*)::int from company_alias where alias_key like 'zz-eq-%' or company_key like 'zz-eq-%') as alias,
      (select count(*)::int from target_company where company_key like 'zz-eq-%') as target`);
  assert.deepEqual({ ...row }, { company: 0, person: 0, alias: 0, target: 0 });
});
