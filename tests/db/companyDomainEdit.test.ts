/**
 * DB-backed test for the unique `company_domain_idx` on the real write path
 * (`updateCompanyProperty`). `isDomainIndexViolation` is unit-tested against a
 * synthetic error; only a real driver error proves the constraint-name shape
 * it looks for, so a driver or version difference cannot silently turn the
 * race path into a generic 500.
 *
 * Two different code paths, tested separately:
 *  - pre-check: another company already holds the domain -> `DomainInUseError`
 *    before any write;
 *  - race: the pre-check misses (forced here by replacing it) and Postgres
 *    raises the real 23505 on UPDATE -> mapped to the same `DomainInUseError`.
 *
 * Opt-in and fail-closed like the other files here: `npm run test:db`, with
 * DATABASE_URL pointing at a local database whose name ends in `_e2e`.
 * Everything runs in one transaction rolled back by a sentinel throw; the
 * write under test nests as a savepoint.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

/**
 * postgres-js holds its pool open and node:test waits for the event loop to
 * drain, so the process only exits once `idle_timeout: 20` (src/db/index.ts)
 * expires: measured 22s wall clock for assertions that finish in well under a
 * second. Closing the pool makes the suite return a prompt immediately, which
 * is the difference between a suite people run and one they avoid.
 * `node --test` gives each file its own process, so each closes its own pool.
 */
after(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});

const ROLLBACK = new Error("rollback");
const BD_ID = "00000000-0000-0000-0000-00000000d0d0";

async function inRolledBackTransaction(body: (tx: Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0]) => Promise<void>): Promise<void> {
  const { db } = await import("@/db");
  try {
    await db.transaction(async (tx) => {
      await body(tx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
}

async function seed(tx: Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0]) {
  const { bd, company } = await import("@/db/schema");
  await tx.insert(bd).values({ id: BD_ID, email: "zz-domain-edit@example.test", name: "ZZ" });
  await tx.insert(company).values([
    { companyKey: "zz-dom-holder", displayName: "Holder", domain: "zz-dom-taken.test" },
    { companyKey: "zz-dom-editor", displayName: "Editor" },
  ]);
}

test("pre-check: a domain held by another company is refused as DomainInUseError, nothing written", async () => {
  await inRolledBackTransaction(async (tx) => {
    await seed(tx);
    const { updateCompanyProperty } = await import("@/lib/companies/propertyEditDb");
    const { DomainInUseError } = await import("@/lib/companies/propertyEdit");
    const { company, companyPropertyHistory } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    await assert.rejects(
      updateCompanyProperty("zz-dom-editor", "domain", "https://www.ZZ-Dom-Taken.test/", BD_ID, { database: tx }),
      (e: unknown) => e instanceof DomainInUseError,
    );
    const [row] = await tx.select({ domain: company.domain }).from(company).where(eq(company.companyKey, "zz-dom-editor"));
    assert.equal(row?.domain, null);
    const history = await tx.select().from(companyPropertyHistory).where(eq(companyPropertyHistory.companyKey, "zz-dom-editor"));
    assert.equal(history.length, 0);
  });
});

test("race: the real 23505 from company_domain_idx is mapped to DomainInUseError", async () => {
  await inRolledBackTransaction(async (tx) => {
    await seed(tx);
    const { updateCompanyProperty } = await import("@/lib/companies/propertyEditDb");
    const { DomainInUseError, isDomainIndexViolation } = await import("@/lib/companies/propertyEdit");
    const { propertyEditFailureOf } = await import("@/lib/companies/propertyEditFailure");

    // The pre-check is bypassed, so the UPDATE itself hits the unique index.
    await assert.rejects(
      updateCompanyProperty("zz-dom-editor", "domain", "zz-dom-taken.test", BD_ID, { database: tx, domainHolder: async () => null }),
      (e: unknown) => {
        assert.ok(e instanceof DomainInUseError, `expected DomainInUseError, got ${String(e)}`);
        assert.deepEqual(propertyEditFailureOf(e), { kind: "domain_in_use" });
        return true;
      },
    );

    // And the raw driver error really is what isDomainIndexViolation recognises.
    const { company } = await import("@/db/schema");
    let raw: unknown;
    try {
      await tx.transaction(async (inner) => {
        await inner.insert(company).values({ companyKey: "zz-dom-third", displayName: "Third", domain: "zz-dom-taken.test" });
      });
    } catch (err) {
      raw = err;
    }
    assert.ok(raw, "the duplicate insert must fail");
    assert.equal(isDomainIndexViolation(raw), true);
  });
});

test("a free domain is written with its history row", async () => {
  await inRolledBackTransaction(async (tx) => {
    await seed(tx);
    const { updateCompanyProperty } = await import("@/lib/companies/propertyEditDb");
    const { companyPropertyHistory } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const updated = await updateCompanyProperty("zz-dom-editor", "domain", "ZZ-Dom-Free.test", BD_ID, { database: tx });
    assert.equal(updated.domain, "zz-dom-free.test");
    const history = await tx.select().from(companyPropertyHistory).where(eq(companyPropertyHistory.companyKey, "zz-dom-editor"));
    assert.equal(history.length, 1);
    assert.equal(history[0]!.property, "domain");
    assert.equal(history[0]!.newValue, "zz-dom-free.test");
    assert.equal(history[0]!.changedByBdId, BD_ID);
  });
});
