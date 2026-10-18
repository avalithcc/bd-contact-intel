/**
 * DB proof of phone search through the contacts-list `searchCondition`: a local Argentine form finds the stored E.164
 * number, the international form finds it, other numbers and non-phone text do not, and the plan uses the suffix index.
 * Opt-in like the other files here: `npm run test:db` with DATABASE_URL on a database named `*_e2e`. Needs migration
 * 0051. Rows are created under a per-run random suffix and removed afterwards.
 */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const suffix = String(randomInt(10_000_000, 99_999_999)); // 8 significant digits
const other = String(randomInt(10_000_000, 99_999_999) === Number(suffix) ? 12_345_678 : randomInt(10_000_000, 99_999_999));
let mobileId: string;
let landlineId: string;
let otherId: string;

before(async () => {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const mk = (first: string, extra: Record<string, unknown>) => {
    const email = `zz-phone-${first}-${run}@example.test`;
    return { firstName: first, lastName: `Phone${run}`, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", ...extra };
  };
  const [m, l, o] = await db
    .insert(person)
    .values([
      mk("Mobile", { mobilePhone: `+54911${suffix}` }),
      mk("Landline", { phone: `+54 11 ${suffix.slice(0, 4)}-${suffix.slice(4)}` }),
      mk("Other", { mobilePhone: `+54911${other}` }),
    ])
    .returning();
  mobileId = m.id;
  landlineId = l.id;
  otherId = o.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(person).where(inArray(person.id, [mobileId, landlineId, otherId]));
});

async function found(q: string): Promise<string[]> {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { and, inArray } = await import("drizzle-orm");
  const { searchCondition } = await import("@/lib/contacts/listQueries");
  const rows = await db
    .select({ id: person.id })
    .from(person)
    .where(and(inArray(person.id, [mobileId, landlineId, otherId]), searchCondition(q)));
  return rows.map((r) => r.id).sort();
}

const a = suffix.slice(0, 4);
const b = suffix.slice(4);

test("every local and international form finds the stored numbers that share the suffix", async () => {
  const expected = [mobileId, landlineId].sort();
  for (const q of [`11 ${a} ${b}`, `11${suffix}`, `011 15 ${a} ${b}`, `15 ${a} ${b}`, `+54 9 11 ${a}-${b}`, `+549 11${suffix}`, `(011) ${a}.${b}`, suffix]) {
    assert.deepEqual(await found(q), expected, q);
  }
});

test("a different number, a 5-digit number and mixed text do not match", async () => {
  assert.deepEqual(await found(`11 ${other.slice(0, 4)} ${other.slice(4)}`), [otherId]);
  assert.deepEqual(await found(suffix.slice(0, 5)), []);
  assert.deepEqual(await found(`Mobile ${suffix}`), []);
});

test("a 6-7 digit fragment matches as a substring of the stored digits", async () => {
  assert.deepEqual(await found(suffix.slice(1, 7)), [mobileId, landlineId].sort());
});

test("name search with accents keeps working next to phone search", async () => {
  assert.deepEqual(await found(`mobile phone${run}`), [mobileId]);
});

test("the suffix query is served by the suffix indexes", async () => {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { phoneSearchCondition } = await import("@/lib/search/phoneCondition");
  const { person } = await import("@/db/schema");
  const cond = phoneSearchCondition(`11 ${a} ${b}`);
  assert.ok(cond);
  const plan = await db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`); // the scratch table is tiny: force the planner to show what it CAN index
    const q = tx.select({ id: person.id }).from(person).where(cond).toSQL();
    const rows = await tx.execute(sql.raw(`explain ${q.sql.replace(/\$\d+/g, `'${suffix}'`)}`));
    return Array.from(rows as unknown as Array<Record<string, string>>).map((r) => r["QUERY PLAN"]).join("\n");
  });
  assert.match(plan, /person_phone_digits_suffix_idx/);
  assert.match(plan, /person_mobile_phone_digits_suffix_idx/);
});
