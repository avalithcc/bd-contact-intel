/**
 * DB-backed proof of the 30-day freshness window on open postings, and that every surface reads the same rule:
 * the Vacantes/hiring read (resolveHiringCompanies), the contact badge keys (getHiringCompanyKeys) and the
 * Sequence roster picker (listRosterCandidates) must put the same company in or out together.
 *
 * Opt-in and fail-closed like the other files here: `npm run test:db`, DATABASE_URL pointing at a database whose
 * name ends in `_e2e`. Every row is created under a per-run token and removed afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const key = (name: string) => `zz-${run}-${name}`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const personIds: string[] = [];
const companyKeys: string[] = [];
let bdId: string | null = null;
let sequenceId: string | null = null;

type Case = { posted: Date | null; first: Date; closed?: Date | null };

async function mkCase(name: string, c: Case) {
  const { db } = await import("@/db");
  const { company, jobPosting, person, targetCompany } = await import("@/db/schema");
  const ck = key(name);
  companyKeys.push(ck);
  await db.insert(company).values({ companyKey: ck, displayName: ck });
  await db.insert(targetCompany).values({ companyKey: ck, displayName: ck, ats: "lever", config: {} });
  await db.insert(jobPosting).values({
    companyKey: ck, externalId: "1", title: "Engineer", location: "Austin, TX", url: "https://example.test",
    isIt: true, market: "us", postedAt: c.posted, firstSeen: c.first, closedAt: c.closed ?? null,
  });
  const email = `${ck}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", company: ck, companyKey: ck }).returning();
  personIds.push(p.id);
  return { ck, personId: p.id };
}

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, emailAccount, jobPosting, person, sequence, targetCompany } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  if (sequenceId) await db.delete(sequence).where(eq(sequence.id, sequenceId));
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  if (companyKeys.length) {
    await db.delete(jobPosting).where(inArray(jobPosting.companyKey, companyKeys));
    await db.delete(targetCompany).where(inArray(targetCompany.companyKey, companyKeys));
    await db.delete(company).where(inArray(company.companyKey, companyKeys));
  }
  if (bdId) {
    await db.delete(emailAccount).where(eq(emailAccount.bdId, bdId));
    await db.delete(bd).where(eq(bd.id, bdId));
  }
  await db.$client.end();
});

test("every surface agrees: 29 days counts, 31 days does not, closed never counts, null posted_at falls back to first_seen", async () => {
  const { resolveHiringCompanies, getHiringCompanyKeys } = await import("@/lib/hiring/queries");
  const { listRosterCandidates } = await import("@/lib/sequences/rosterQueries");

  const cases = {
    fresh29: await mkCase("fresh29", { posted: daysAgo(29), first: daysAgo(29) }),
    stale31: await mkCase("stale31", { posted: daysAgo(31), first: daysAgo(31) }),
    closedFresh: await mkCase("closed", { posted: daysAgo(2), first: daysAgo(2), closed: daysAgo(1) }),
    nullFresh: await mkCase("nullfresh", { posted: null, first: daysAgo(5) }),
    nullStale: await mkCase("nullstale", { posted: null, first: daysAgo(40) }),
    // posted_at wins over first_seen: a re-discovered old posting is judged by its own date, and a
    // freshly published one is not hidden because our sync saw it late.
    postedFreshSeenOld: await mkCase("postedfresh", { posted: daysAgo(3), first: daysAgo(90) }),
    postedStaleSeenNew: await mkCase("postedstale", { posted: daysAgo(90), first: daysAgo(1) }),
  };
  const expectedIn = new Set(["fresh29", "nullFresh", "postedFreshSeenOld"]);

  const hiring = await resolveHiringCompanies("us");
  const badge = await getHiringCompanyKeys();
  const { db } = await import("@/db");
  const { bd, emailAccount, sequence, sequenceMember } = await import("@/db/schema");
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const { getCompanyPostingsForKey } = await import("@/lib/hiring/queries");
  bdId = (await db.insert(bd).values({ name: "ZZ Fresh", email: `zz-fresh-${run}@example.test` }).returning())[0].id;
  const [acc] = await db.insert(emailAccount).values({ bdId, emailAddress: `zz-fresh-sender-${run}@example.test` }).returning();
  sequenceId = (await db.insert(sequence).values({ name: key("seq"), ownerBdId: bdId, emailAccountId: acc.id, schedule: {} }).returning())[0].id;
  await db.insert(sequenceMember).values(Object.values(cases).map((c) => ({ sequenceId: sequenceId!, personId: c.personId, state: "drafted" })));
  const detail = await getSequenceDetail({ id: bdId, role: "bd" }, sequenceId);
  const cardOpenIt = new Map(detail!.members.map((m) => [m.personId, m.openIt]));
  const roster = new Set((await listRosterCandidates({ limit: 200, search: run })).map((r) => r.person_id));

  for (const [name, { ck, personId }] of Object.entries(cases)) {
    const want = expectedIn.has(name);
    assert.equal(hiring.has(ck), want, `hiring page: ${name}`);
    assert.equal(badge.has(ck), want, `badge keys: ${name}`);
    assert.equal(roster.has(personId), want, `sequence roster: ${name}`);
    // roster eligibility == member card count == contact/company/draft-signal count
    assert.equal(cardOpenIt.get(personId), want ? 1 : 0, `member card openIt: ${name}`);
    assert.equal((await getCompanyPostingsForKey(ck))?.totalCount ?? 0, want ? 1 : 0, `getCompanyPostingsForKey: ${name}`);
  }
});
