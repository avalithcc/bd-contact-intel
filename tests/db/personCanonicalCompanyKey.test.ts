/**
 * DB-backed test for `getCanonicalCompanyKeyForPerson`: the one-statement
 * person -> canonical company key resolver that the contact-activity action uses
 * to revalidate the company record page. It must agree with
 * `companyContactsCondition` (the query that builds the company timeline), so the
 * collision case (an alias row whose key is also a live company) is built here
 * and has to resolve to the live company itself.
 *
 * Opt-in and fail-closed: `npm run test:db`, with DATABASE_URL pointing at a
 * local database whose name ends in `_e2e`. The guard runs BEFORE `@/db` is
 * imported, so a production URL fails without opening a connection. Everything
 * runs in one transaction rolled back by a sentinel throw.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

// Close the pool so the suite returns promptly (see aliasEquivalence.test.ts).
after(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});

const ROLLBACK = new Error("rollback");

type Tx = Pick<typeof import("@/db").db, "select" | "insert" | "execute">;

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

async function seed(tx: Tx) {
  const { company, companyAlias, person } = await import("@/db/schema");
  await tx.insert(company).values([
    { companyKey: "zz-pc-canon", displayName: "Canon" },
    { companyKey: "zz-pc-live", displayName: "Live" },
    { companyKey: "zz-pc-other", displayName: "Other" },
  ]);
  await tx.insert(companyAlias).values([
    { aliasKey: "zz-pc-dead", companyKey: "zz-pc-canon" },
    // Collision: this alias key is itself a live company, so it owns its key.
    { aliasKey: "zz-pc-live", companyKey: "zz-pc-other" },
  ]);
  const personAt = async (companyKey?: string) => {
    const [row] = await tx.insert(person).values(companyKey ? { companyKey } : {}).returning({ id: person.id });
    return row!.id;
  };
  return { personAt };
}

test("a person on a canonical company key resolves to that key", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { getCanonicalCompanyKeyForPerson } = await import("@/lib/companies/aliasResolutionDb");
    const { personAt } = await seed(tx);
    assert.equal(await getCanonicalCompanyKeyForPerson(await personAt("zz-pc-canon"), tx), "zz-pc-canon");
  });
});

test("a person on an alias key resolves to the canonical company", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { getCanonicalCompanyKeyForPerson } = await import("@/lib/companies/aliasResolutionDb");
    const { personAt } = await seed(tx);
    assert.equal(await getCanonicalCompanyKeyForPerson(await personAt("zz-pc-dead"), tx), "zz-pc-canon");
  });
});

test("a key that is both an alias row and a live company resolves to itself", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { getCanonicalCompanyKeyForPerson } = await import("@/lib/companies/aliasResolutionDb");
    const { personAt } = await seed(tx);
    assert.equal(await getCanonicalCompanyKeyForPerson(await personAt("zz-pc-live"), tx), "zz-pc-live");
  });
});

test("a person with no company key resolves to null", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { getCanonicalCompanyKeyForPerson } = await import("@/lib/companies/aliasResolutionDb");
    const { personAt } = await seed(tx);
    assert.equal(await getCanonicalCompanyKeyForPerson(await personAt(), tx), null);
  });
});

test("a key that matches no company and no alias resolves to null", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { getCanonicalCompanyKeyForPerson } = await import("@/lib/companies/aliasResolutionDb");
    const { personAt } = await seed(tx);
    assert.equal(await getCanonicalCompanyKeyForPerson(await personAt("zz-pc-nothing"), tx), null);
  });
});

test("an unknown person id resolves to null", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { getCanonicalCompanyKeyForPerson } = await import("@/lib/companies/aliasResolutionDb");
    await seed(tx);
    assert.equal(await getCanonicalCompanyKeyForPerson("00000000-0000-4000-8000-000000000000", tx), null);
  });
});
