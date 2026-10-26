/**
 * The Outreach view's "Último contacto" cell must name the newest activity exactly as the contacts list does.
 * The invariant pinned here: for the same seeded person, the label (and time) the Outreach row carries equals the
 * one `getContactListPage` gives. Also pins that the added subquery does not fan out the LinkedIn aggregate.
 * Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local `_e2e` database. Rows are committed (the list
 * read uses the shared pool) under a per-run suffix and removed afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const lastName = `NamedAct${run}`;
const LI_AT = new Date("2026-10-10T10:00:00.000Z");
const AT = new Date("2026-10-20T10:00:00.000Z");
const KINDS = ["email_sent", "reply_received", "auto_reply_received", "none", "linkedin_only", "touch_and_linkedin"];
const ids: Record<string, string> = {};
const bdIds: string[] = [];

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, person, personBdConnection } = await import("@/db/schema");
  const mkBd = async (n: string) =>
    (await db.insert(bd).values({ email: `zz-na-${n}-${run}@example.test`, name: `ZZ ${n}` }).returning())[0]!;
  const me = await mkBd("me");
  const other = await mkBd("other");
  bdIds.push(me.id, other.id);
  ids.me = me.id;
  const kinds = KINDS;
  for (const kind of kinds) {
    const [p] = await db.insert(person).values({ firstName: kind, lastName }).returning();
    ids[kind] = p!.id;
    if (kind === "linkedin_only") {
      await db.insert(personBdConnection).values({ personId: p!.id, bdId: me.id, messageCount: 2, lastMessageAt: LI_AT, reciprocal: false });
    } else if (kind === "touch_and_linkedin") {
      // The LinkedIn date is NEWER than the activity: the real touch must still win.
      await db.insert(activity).values({ personId: p!.id, actorBdId: me.id, type: "email_sent", metadata: {}, createdAt: AT });
      await db.insert(personBdConnection).values({ personId: p!.id, bdId: me.id, messageCount: 2, lastMessageAt: new Date("2026-10-25T10:00:00Z"), reciprocal: false });
    } else if (kind !== "none") {
      await db.insert(activity).values({ personId: p!.id, actorBdId: me.id, type: kind, metadata: {}, createdAt: AT });
    }
  }
  // Older touches under the newest one: the pick must be the newest, not any row.
  await db.insert(activity).values([
    { personId: ids.email_sent!, actorBdId: me.id, type: "note", metadata: {}, createdAt: new Date("2026-09-01T10:00:00Z") },
    { personId: ids.email_sent!, actorBdId: me.id, type: "meeting_logged", metadata: {}, createdAt: new Date("2026-08-01T10:00:00Z") },
  ]);
  // Two BD connections + an activity: the aggregate must stay 3 + 4 = 7.
  await db.insert(personBdConnection).values([
    { personId: ids.email_sent!, bdId: me.id, messageCount: 3, lastMessageAt: new Date("2026-01-01T00:00:00Z"), reciprocal: false },
    { personId: ids.email_sent!, bdId: other.id, messageCount: 4, lastMessageAt: new Date("2026-01-02T00:00:00Z"), reciprocal: false },
  ]);
});

after(async () => {
  const { db } = await import("@/db");
  const { activity, bd, person, personBdConnection } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  const personIds = KINDS.map((k) => ids[k]!);
  await db.delete(activity).where(inArray(activity.personId, personIds));
  await db.delete(personBdConnection).where(inArray(personBdConnection.personId, personIds));
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(bd).where(inArray(bd.id, bdIds));
  await db.$client.end();
});

async function outreachCell(personId: string) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { selectOutreachRows } = await import("@/lib/outreach/queries");
  const { attachOutreachReasons } = await import("@/lib/contacts/outreachView");
  const { es } = await import("@/lib/i18n/dictionaries/es");
  const rows = await selectOutreachRows(db, ids.me!, eq(person.id, personId), true);
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  const [mapped] = attachOutreachReasons(
    [{ ...r, lastMessageAt: null, roleGroup: null, dormant: false, isLeadership: false, relationshipTier: "never_messaged", companyDisplayName: "", openItCount: 0, offshoreItCount: 0, latamItCount: 0, offshoreHeavy: false, isStartup: null, startupReason: null, hasOwnContact: false } as never],
    () => "x",
    es as never,
  );
  return { row: r, lastActivity: mapped!.lastActivity };
}

for (const kind of KINDS) {
  test(`outreach row and contacts list agree on the last activity of a person whose latest is ${kind}`, async () => {
    const { getContactListPage } = await import("@/lib/contacts/listQueries");
    const { es } = await import("@/lib/i18n/dictionaries/es");
    const list = await getContactListPage({}, ids.me!, lastName, 1, 50, es as never);
    const listed = list.rows.find((r) => r.id === ids[kind]);
    assert.ok(listed, "person is in the contacts list");
    const { lastActivity } = await outreachCell(ids[kind]!);
    if (kind === "none") {
      assert.equal(listed.lastActivity, null);
      assert.equal(lastActivity, null);
      return;
    }
    assert.ok(lastActivity);
    assert.equal(lastActivity.label, listed.lastActivity?.label);
    assert.equal(lastActivity.createdAt.toISOString(), listed.lastActivity?.createdAt.toISOString());
    const expectedAt = kind === "linkedin_only" ? LI_AT : AT;
    assert.equal(lastActivity.createdAt.toISOString(), expectedAt.toISOString());
    if (kind === "linkedin_only") assert.equal(lastActivity.label, es.contactList.lastActivityLinkedin);
    if (kind === "touch_and_linkedin") assert.equal(lastActivity.label, es.contactList.lastActivityEmailSent);
  });
}

test("adding the named-activity subquery leaves the LinkedIn message sum untouched", async () => {
  const { row } = await outreachCell(ids.email_sent!);
  assert.equal(row.messageCount, 7);
});
