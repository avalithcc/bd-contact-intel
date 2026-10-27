/**
 * DB-backed test for the audience each Sequence member carries (getSequenceDetail): the reason the draft's language and
 * address come from (own country, the colleagues' majority, the company, ...). The roster's own contract is in
 * sequenceRosterConsensus.test.ts. Scratch database only.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const ck = `zz-${run}-acme`;
let ownerId: string;
let accountId: string;
let sequenceId: string;
const personIds: string[] = [];
const members: Record<string, string> = {};

async function mkPerson(name: string, over: { country?: string; email?: string; merged?: boolean; member?: boolean; phone?: string } = {}) {
  const { db } = await import("@/db");
  const { person, sequenceMember } = await import("@/db/schema");
  const email = over.email ?? `zz-${run}-${name}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email || null, emailStatus: "verified", emailSource: "apollo", company: ck, companyKey: ck, country: over.country ?? null, phone: over.phone ?? null }).returning();
  personIds.push(p.id);
  if (over.merged) await db.execute((await import("drizzle-orm")).sql`update person set merged_into_id = ${personIds[0]}::uuid where id = ${p.id}::uuid`);
  if (over.member) members[name] = (await db.insert(sequenceMember).values({ sequenceId, personId: p.id, state: "drafted" }).returning())[0].id;
}

before(async () => {
  const { db } = await import("@/db");
  const { bd, company, emailAccount, sequence } = await import("@/db/schema");
  ownerId = (await db.insert(bd).values({ name: "ZZ aud", email: `zz-aud-${run}@example.test`, role: "bd" }).returning())[0].id;
  accountId = (await db.insert(emailAccount).values({ bdId: ownerId, emailAddress: `zz-aud-sender-${run}@example.test` }).returning())[0].id;
  sequenceId = (await db.insert(sequence).values({ name: `zz-${run}`, ownerBdId: ownerId, emailAccountId: accountId, schedule: {} }).returning())[0].id;
  await db.insert(company).values({ companyKey: ck, displayName: ck, country: "United States" });
  await mkPerson("target", { member: true, phone: "+54 223 632 4960" });
  await mkPerson("own", { member: true, country: "Argentina" });
  await mkPerson("blankA");
  await mkPerson("blankB");
  await mkPerson("ar", { country: "Argentina" });
  await mkPerson("us", { country: "USA" });
  await mkPerson("noemail", { email: "" });
  await mkPerson("merged", { merged: true });
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, emailAccount, person, sequence } = await import("@/db/schema");
  const { inArray, eq } = await import("drizzle-orm");
  await db.delete(sequence).where(eq(sequence.ownerBdId, ownerId));
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(company).where(eq(company.companyKey, ck));
  await db.delete(emailAccount).where(eq(emailAccount.bdId, ownerId));
  await db.delete(bd).where(eq(bd.id, ownerId));
});

test("the roster decides over the company country: the colleagues' majority, not the filed United States", async () => {
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const d = await getSequenceDetail({ id: ownerId, role: "bd" }, sequenceId);
  const a = d!.members.find((m) => m.memberId === members.target)!.audience!;
  // Colleagues with a country: own and ar (Argentina), us (USA). blankA, blankB and noemail have none; merged is not a colleague.
  assert.equal(a.reason, "roster_consensus");
  assert.equal(a.evidence, "AR");
  assert.deepEqual(a.colleagues, { agree: 2, of: 3 });
  assert.deepEqual(a.audience, { address: "mdp", language: "es" });
  assert.equal(a.companyIgnored, "United States");
  assert.equal(a.unusedPhone, null, "the phone cannot change a roster answer, so it is not offered");
});

test("a person's own country decides and the roster is ignored", async () => {
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const d = await getSequenceDetail({ id: ownerId, role: "bd" }, sequenceId);
  const a = d!.members.find((m) => m.memberId === members.own)!.audience!;
  assert.equal(a.reason, "person_country");
});
