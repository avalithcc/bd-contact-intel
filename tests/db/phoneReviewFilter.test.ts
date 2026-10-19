/**
 * DB proof of the "Teléfono a revisar" list filter (phone-review-marker): a live contact whose phone or mobile_phone is
 * non-blank and not E.164-shaped is listed; E.164, empty, NULL and merged-away contacts are not. Opt-in like the other
 * files here: `npm run test:db` with DATABASE_URL on a database named `*_e2e`. Rows are created under a per-run random
 * suffix and removed afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const ids: Record<string, string> = {};

before(async () => {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const mk = (key: string, extra: Record<string, unknown>) => {
    const email = `zz-pr-${key}-${run}@example.test`;
    return { firstName: key, lastName: `PhoneReview${run}`, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", ...extra };
  };
  const mergedTarget = await db.insert(person).values(mk("target", { phone: "+5491155550001" })).returning();
  const rows = await db
    .insert(person)
    .values([
      mk("nocountry", { phone: "1141234567" }),
      mk("mobileplus", { mobilePhone: "+54 11 99" }),
      mk("mixed", { phone: "+5491155550002", mobilePhone: "011 4123-4567" }),
      mk("clean", { phone: "+5491155550003", mobilePhone: "+14155550123" }),
      mk("blank", { phone: "   ", mobilePhone: "" }),
      mk("nophone", {}),
      mk("merged", { phone: "1141234567", mergedIntoId: mergedTarget[0].id }),
    ])
    .returning();
  for (const r of [...mergedTarget, ...rows]) ids[r.firstName ?? ""] = r.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  // The merged-away row points at the target: delete it first.
  await db.delete(person).where(inArray(person.id, [ids.merged]));
  await db.delete(person).where(inArray(person.id, Object.values(ids).filter((id) => id !== ids.merged)));
});

test("phoneReview lists live contacts with a non-E.164 phone or mobile, in either column", async () => {
  const { getContactListPage } = await import("@/lib/contacts/listQueries");
  const { es } = await import("@/lib/i18n/dictionaries/es");
  const page = await getContactListPage({ phoneReview: true }, randomUUID(), run, 1, 50, es as never);
  const names = page.rows.map((r) => r.firstName).sort();
  assert.deepEqual(names, ["mixed", "mobileplus", "nocountry"]);
  assert.equal(page.total, 3);
});

test("without the filter the same search lists every live contact of the run", async () => {
  const { getContactListPage } = await import("@/lib/contacts/listQueries");
  const { es } = await import("@/lib/i18n/dictionaries/es");
  const page = await getContactListPage({}, randomUUID(), run, 1, 50, es as never);
  assert.equal(page.total, 7); // target + 6 live rows; the merged-away one is excluded
});
