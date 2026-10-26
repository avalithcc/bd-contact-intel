/**
 * Outreach "last contact" against a scratch database: `selectOutreachRows` (the query behind listOutreachCandidates)
 * must report the newest touch of ANY kind, and an activity row must never move `messageCount`. Opt-in and fail-closed:
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
const OLD_EMAIL_AT = new Date("2026-01-05T10:00:00.000Z");

async function seed(tx: Tx, opts: { linkedin: boolean; activities: { type: string; at: Date }[] }) {
  const { activity, bd, person, personBdConnection } = await import("@/db/schema");
  const [me] = await tx.insert(bd).values({ email: `zz-lc-${Math.random().toString(36).slice(2)}@example.test`, name: "ZZ Me" }).returning();
  const [p] = await tx.insert(person).values({ firstName: "Lucía", lastName: "Fernández" }).returning();
  if (opts.linkedin) {
    await tx.insert(personBdConnection).values({ personId: p!.id, bdId: me!.id, messageCount: 7, lastMessageAt: LINKEDIN_AT, reciprocal: true });
  }
  for (const a of opts.activities) {
    await tx.insert(activity).values({ personId: p!.id, actorBdId: me!.id, type: a.type, metadata: {}, createdAt: a.at });
  }
  return { meId: me!.id, personId: p!.id };
}

async function rowOf(tx: Tx, meId: string, personId: string) {
  const { eq } = await import("drizzle-orm");
  const { person } = await import("@/db/schema");
  const { selectOutreachRows } = await import("@/lib/outreach/queries");
  const rows = await selectOutreachRows(tx as never, meId, eq(person.id, personId), true);
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  const { parseDbTimestamp } = await import("@/lib/db/timestamp");
  return { messageCount: r.messageCount, lastMessageAt: r.lastMessageAt == null ? null : parseDbTimestamp(r.lastMessageAt) };
}

test("a person whose only contact is an email reports that email's time as lastMessageAt", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { meId, personId } = await seed(tx, { linkedin: false, activities: [{ type: "email_sent", at: EMAIL_AT }] });
    const r = await rowOf(tx, meId, personId);
    assert.equal(r.lastMessageAt?.toISOString(), EMAIL_AT.toISOString());
  });
});

test("a person with a LinkedIn date and a newer email reports the email's time", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { meId, personId } = await seed(tx, { linkedin: true, activities: [{ type: "email_sent", at: EMAIL_AT }] });
    const r = await rowOf(tx, meId, personId);
    assert.equal(r.lastMessageAt?.toISOString(), EMAIL_AT.toISOString());
  });
});

test("a person with a LinkedIn date and an older email keeps the LinkedIn date", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { meId, personId } = await seed(tx, { linkedin: true, activities: [{ type: "email_sent", at: OLD_EMAIL_AT }] });
    const r = await rowOf(tx, meId, personId);
    assert.equal(r.lastMessageAt?.toISOString(), LINKEDIN_AT.toISOString());
  });
});

test("a person with LinkedIn only and no activity keeps the LinkedIn date", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { meId, personId } = await seed(tx, { linkedin: true, activities: [] });
    const r = await rowOf(tx, meId, personId);
    assert.equal(r.lastMessageAt?.toISOString(), LINKEDIN_AT.toISOString());
  });
});

test("a task row newer than the touches is not a contact (non-touch type)", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { meId, personId } = await seed(tx, {
      linkedin: true,
      activities: [{ type: "email_sent", at: OLD_EMAIL_AT }, { type: "task_created", at: EMAIL_AT }],
    });
    const r = await rowOf(tx, meId, personId);
    assert.equal(r.lastMessageAt?.toISOString(), LINKEDIN_AT.toISOString());
  });
});

test("messageCount stays the LinkedIn sum however many activities the person has", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { meId, personId } = await seed(tx, {
      linkedin: true,
      activities: [
        { type: "email_sent", at: EMAIL_AT },
        { type: "email_sent", at: OLD_EMAIL_AT },
        { type: "call", at: OLD_EMAIL_AT },
      ],
    });
    const r = await rowOf(tx, meId, personId);
    assert.equal(r.messageCount, 7);
  });
});

test("another BD's activity counts as contact: a touch logged by a different BD is the viewer's lastMessageAt", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { activity, bd } = await import("@/db/schema");
    const { meId, personId } = await seed(tx, { linkedin: false, activities: [] });
    const [other] = await tx.insert(bd).values({ email: `zz-lc-other-${Math.random().toString(36).slice(2)}@example.test`, name: "ZZ Other" }).returning();
    await tx.insert(activity).values({ personId, actorBdId: other!.id, type: "email_sent", metadata: {}, createdAt: EMAIL_AT });
    const r = await rowOf(tx, meId, personId);
    assert.equal(r.lastMessageAt?.toISOString(), EMAIL_AT.toISOString());
  });
});
