/**
 * DB-backed pin of ONE company-country rule across every reader of the recipient market. A contact whose OWN company row
 * has a blank country while the canonical company (the alias target) has one is the case the older readers
 * (`company_key = p.company_key or company_key in (alias subquery) limit 1`) resolved arbitrarily: the picker listed the
 * contact, then the draft path held it, or worse wrote the wrong region's footer. Every reader must now see the canonical
 * country (`firstFilledCountry`). Opt-in and fail-closed: `npm run test:db`, DATABASE_URL naming a `*_e2e` database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const key = (name: string) => `zz-${run}-${name}`;
const LATAM_ADDRESS = "Mar del Plata";
let bdId: string;
let sequenceId: string;
let memberId: string;
let personId: string;
let firstName: string;
let ownDisplayName: string;
const companyKeys: string[] = [];

before(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, emailAccount, person, sequence, sequenceMember } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Country", email: `zz-country-${run}@example.test` }).returning();
  bdId = b.id;
  const [acc] = await db.insert(emailAccount).values({ bdId, emailAddress: `zz-country-sender-${run}@example.test` }).returning();
  const [s] = await db.insert(sequence).values({ name: key("seq"), ownerBdId: bdId, emailAccountId: acc.id, schedule: {} }).returning();
  sequenceId = s.id;
  const own = key("own");
  const canonical = key("canonical");
  companyKeys.push(own, canonical);
  ownDisplayName = `Own ${own}`;
  // The own row holds a BLANK country, the canonical one a real country: a mapped market only the canonical row can give.
  // The blank own row is inserted FIRST so a `limit 1` with no ORDER BY would return it (physical order), not the filled one.
  await db.insert(company).values({ companyKey: own, displayName: ownDisplayName, country: "   " });
  await db.insert(company).values({ companyKey: canonical, displayName: `Canonical ${canonical}`, country: "Argentina" });
  await db.insert(companyAlias).values({ aliasKey: own, companyKey: canonical });
  firstName = `Country${run}`;
  const email = `${key("person")}@example.test`;
  const [p] = await db.insert(person).values({ firstName, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", company: ownDisplayName, companyKey: own, country: null }).returning();
  personId = p.id;
  const [m] = await db.insert(sequenceMember).values({ sequenceId, personId, state: "drafted" }).returning();
  memberId = m.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, emailAccount, person, sequence } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(sequence).where(inArray(sequence.ownerBdId, [bdId]));
  await db.delete(person).where(inArray(person.id, [personId]));
  await db.delete(companyAlias).where(inArray(companyAlias.aliasKey, companyKeys));
  await db.delete(company).where(inArray(company.companyKey, companyKeys));
  await db.delete(emailAccount).where(inArray(emailAccount.bdId, [bdId]));
  await db.delete(bd).where(inArray(bd.id, [bdId]));
});

test("the picker lists the contact as addable: the canonical company's country decides", async () => {
  const { listPickerPage } = await import("@/lib/sequences/pageQueries");
  const { DEFAULT_PICKER_QUERY } = await import("@/lib/sequences/pickerFilters");
  const page = await listPickerPage({ ...DEFAULT_PICKER_QUERY, search: firstName, showBlocked: true }, bdId, "?");
  const row = page.contacts.find((c) => c.personId === personId);
  assert.ok(row, "listed");
  assert.equal(row.block, null);
});

test("the add guard admits the same contact", async () => {
  const { addMembersToSequence } = await import("@/lib/sequences/rosterQueries");
  const { db } = await import("@/db");
  const { sequence } = await import("@/db/schema");
  const [s] = await db.insert(sequence).values({ name: key("seq-add"), ownerBdId: bdId, emailAccountId: (await db.query.sequence.findFirst({ where: (t, { eq }) => eq(t.id, sequenceId) }))!.emailAccountId, schedule: {} }).returning();
  const result = await addMembersToSequence(bdId, s.id, [personId]);
  assert.ok(result.ok);
  assert.deepEqual(result.rejected, []);
});

test("the draft path writes the LATAM footer and does not hold the member", async () => {
  const { generateMemberDraft } = await import("@/lib/sequences/draftQueries");
  const generate = async () => ({ ok: true as const, channel: "email" as const, message: "", subject: "Hi", body: "Hi,\n\nPitch.\n\nCristian", historyCount: 0, signals: [] });
  const result = await generateMemberDraft(bdId, sequenceId, memberId, { generate: generate as never, siteUrl: "https://example.test" });
  assert.ok(result.ok && result.generated.includes(memberId), JSON.stringify(result));
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [draft] = await db.select().from(sequenceDraft).where(eq(sequenceDraft.sequenceMemberId, memberId));
  assert.ok(draft.body.includes(LATAM_ADDRESS), draft.body);
  assert.ok(!draft.body.includes("Hallandale"));
});

test("the unsubscribe page shows the LATAM address from the token the draft issued", async () => {
  const { db } = await import("@/db");
  const { sequenceUnsubscribeToken } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { postalAddressForToken } = await import("@/lib/sequences/unsubscribeQueries");
  const [token] = await db.select().from(sequenceUnsubscribeToken).where(eq(sequenceUnsubscribeToken.sequenceMemberId, memberId));
  assert.ok((await postalAddressForToken(token.tokenHash))?.includes(LATAM_ADDRESS));
});

test("the release read resolves the member's market as latam", async () => {
  const { db } = await import("@/db");
  const { sequenceDraft, sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { loadReleaseCandidates } = await import("@/lib/sequences/releaseQueries");
  const past = new Date(Date.now() - 3_600_000);
  await db.update(sequenceDraft).set({ approvedAt: past, scheduledFor: past }).where(eq(sequenceDraft.sequenceMemberId, memberId));
  await db.update(sequenceMember).set({ state: "approved" }).where(eq(sequenceMember.id, memberId));
  const { candidates } = await loadReleaseCandidates(new Date(), 500, { memberIds: [memberId], ownerBdId: bdId });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].market, "latam");
});

test("the seed dry run resolves the same contact to latam", async () => {
  const { seedFirstSequence } = await import("@/lib/sequences/seedQueries");
  const result = await seedFirstSequence({ actorBdId: bdId, apply: false, roster: [{ name: `${firstName} ${run}`, company: ownDisplayName }], sequenceName: key("seed") });
  assert.equal(result.plan.lines.length, 1);
  assert.equal(result.plan.lines[0].market, "latam");
});
