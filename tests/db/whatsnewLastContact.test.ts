/**
 * What's New "last contact" against a scratch database: `selectWhatsNewContacts` (query 5 of getWhatsNewFeed, contact-keyed)
 * must report the SAME last contact as `selectOutreachRows` (person-keyed) for the same person. Opt-in and fail-closed:
 * `npm run test:db`, DATABASE_URL a local `_e2e` database. Each test runs in one transaction rolled back by a sentinel throw.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

after(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});

const ROLLBACK = new Error("rollback");
type Tx = Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0];

async function inRolledBackTransaction(body: (tx: Tx) => Promise<void>): Promise<void> {
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

const LINKEDIN_AT = new Date("2026-03-01T10:00:00.000Z");
const EMAIL_AT = new Date("2026-10-26T09:40:00.000Z");
const COMPANY_KEY = "zz-wnlc-co";

/** One person, mirrored by one legacy contact for `me` (as the identity migration leaves them). */
async function seed(tx: Tx, opts: { linkedin: boolean; activities: { type: string; at: Date }[]; mapped?: boolean }) {
  const { activity, bd, contact, person, personBdConnection, personIdMap } = await import("@/db/schema");
  const [me] = await tx.insert(bd).values({ email: `zz-wnlc-${Math.random().toString(36).slice(2)}@example.test`, name: "ZZ Me" }).returning();
  const [p] = await tx.insert(person).values({ firstName: "Lucía", lastName: "Fernández", companyKey: COMPANY_KEY }).returning();
  const [c] = await tx
    .insert(contact)
    .values({
      bdId: me!.id,
      profileKey: `zz-wnlc-${Math.random().toString(36).slice(2)}`,
      firstName: "Lucía",
      lastName: "Fernández",
      companyKey: COMPANY_KEY,
      messageCount: opts.linkedin ? 7 : 0,
      lastMessageAt: opts.linkedin ? LINKEDIN_AT : null,
      reciprocal: opts.linkedin,
    })
    .returning();
  if (opts.mapped !== false) await tx.insert(personIdMap).values({ legacyTable: "contact", legacyId: c!.id, personId: p!.id, method: "new" });
  if (opts.linkedin) {
    await tx.insert(personBdConnection).values({ personId: p!.id, bdId: me!.id, messageCount: 7, lastMessageAt: LINKEDIN_AT, reciprocal: true });
  }
  for (const a of opts.activities) {
    await tx.insert(activity).values({ personId: p!.id, actorBdId: me!.id, type: a.type, metadata: {}, createdAt: a.at });
  }
  return { meId: me!.id, personId: p!.id, contactId: c!.id };
}

async function bothScreens(tx: Tx, s: { meId: string; personId: string; contactId: string }) {
  const { eq } = await import("drizzle-orm");
  const { person } = await import("@/db/schema");
  const { selectOutreachRows } = await import("@/lib/outreach/queries");
  const { selectWhatsNewContacts } = await import("@/lib/whatsnew/queries");
  const { parseDbTimestamp } = await import("@/lib/db/timestamp");
  const outreach = await selectOutreachRows(tx as never, s.meId, eq(person.id, s.personId), true);
  const whatsnew = (await selectWhatsNewContacts(tx as never, s.meId, [COMPANY_KEY])).filter((r) => r.id === s.contactId);
  assert.equal(outreach.length, 1);
  assert.equal(whatsnew.length, 1);
  const iso = (v: Date | string | null) => (v == null ? null : parseDbTimestamp(v).toISOString());
  return { outreachAt: iso(outreach[0]!.lastMessageAt), whatsnewAt: iso(whatsnew[0]!.lastMessageAt) };
}

test("a person whose only touch is an email: What's New reports that email and agrees with /outreach", async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seed(tx, { linkedin: false, activities: [{ type: "email_sent", at: EMAIL_AT }] });
    const r = await bothScreens(tx, s);
    assert.equal(r.whatsnewAt, EMAIL_AT.toISOString());
    assert.equal(r.whatsnewAt, r.outreachAt);
  });
});

test("a LinkedIn date and a newer email: both screens report the email", async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seed(tx, { linkedin: true, activities: [{ type: "email_sent", at: EMAIL_AT }] });
    const r = await bothScreens(tx, s);
    assert.equal(r.whatsnewAt, EMAIL_AT.toISOString());
    assert.equal(r.whatsnewAt, r.outreachAt);
  });
});

test("LinkedIn only, no activity: both screens keep the LinkedIn date", async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seed(tx, { linkedin: true, activities: [] });
    const r = await bothScreens(tx, s);
    assert.equal(r.whatsnewAt, LINKEDIN_AT.toISOString());
    assert.equal(r.whatsnewAt, r.outreachAt);
  });
});

test("a contact with no person_id_map row falls back to its own LinkedIn date instead of NULL", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { selectWhatsNewContacts } = await import("@/lib/whatsnew/queries");
    const { parseDbTimestamp } = await import("@/lib/db/timestamp");
    const s = await seed(tx, { linkedin: true, activities: [], mapped: false });
    const rows = (await selectWhatsNewContacts(tx as never, s.meId, [COMPANY_KEY])).filter((r) => r.id === s.contactId);
    assert.equal(rows.length, 1);
    assert.equal(parseDbTimestamp(rows[0]!.lastMessageAt!).toISOString(), LINKEDIN_AT.toISOString());
  });
});
