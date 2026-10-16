/**
 * A Contact note deleted from the Contact record is still a row in the company's Activity tab (a tombstone, never a gap),
 * with its text withheld on the server and left out of that view's counts. Opt-in and fail-closed like the other files here.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const companyKey = `zz-note-co-${run}`;
const SECRET = "text that must not reach the company tab";
let authorId: string;
let adminId: string;
let personId: string;
let deletedNoteId: string;
let liveNoteId: string;

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, company, person } = await import("@/db/schema");
  const bds = await db
    .insert(bd)
    .values([
      { name: "ZZ Co Author", email: `zz-co-author-${run}@example.test` },
      { name: "ZZ Co Admin", email: `zz-co-admin-${run}@example.test`, role: "admin" },
    ])
    .returning();
  authorId = bds[0]!.id;
  adminId = bds[1]!.id;
  await db.insert(company).values({ companyKey, displayName: `ZZ Co ${run}` });
  const [p] = await db.insert(person).values({ firstName: "Co", lastName: run, email: `co-${run}@prospect.test`, emailNormalized: `co-${run}@prospect.test`, companyKey, ownerBdId: authorId, status: "contacted" }).returning();
  personId = p!.id;
  const rows = await db
    .insert(activity)
    .values([
      { personId, actorBdId: authorId, type: "note", metadata: { note: SECRET } },
      { personId, actorBdId: authorId, type: "note", metadata: { note: "a live note" } },
    ])
    .returning();
  deletedNoteId = rows[0]!.id;
  liveNoteId = rows[1]!.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, person } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  await db.delete(person).where(eq(person.id, personId)); // cascades activity
  await db.delete(company).where(eq(company.companyKey, companyKey));
  await db.delete(bd).where(inArray(bd.id, [authorId, adminId]));
});

test("the company tab keeps a tombstone for a deleted contact note: names, no body, not counted", async () => {
  const { getCompanyTimeline, getCompanyTimelineFilterCounts } = await import("@/lib/companies/recordQueries");
  const { softDeleteContactNote } = await import("@/lib/activity/noteDeleteDb");

  const before = await getCompanyTimelineFilterCounts(companyKey);
  assert.deepEqual([before.all, before.contact_activity], [2, 2]);

  await softDeleteContactNote({ id: adminId, role: "admin" }, deletedNoteId);

  const rows = await getCompanyTimeline(companyKey);
  assert.equal(rows.length, 2, "the deleted note is still a row: no gap");
  const tomb = rows.find((r) => r.id === deletedNoteId)!;
  assert.equal(tomb.metadata, null);
  assert.ok(!JSON.stringify(tomb).includes(SECRET), "the text must not reach the client");
  assert.equal(tomb.actorName, "ZZ Co Author");
  assert.equal(tomb.deleted?.byName, "ZZ Co Admin");
  assert.equal(tomb.deleted?.byBdId, adminId);
  assert.deepEqual(rows.find((r) => r.id === liveNoteId)!.metadata, { note: "a live note" });
  assert.equal(rows.find((r) => r.id === liveNoteId)!.deleted ?? null, null);

  const filtered = await getCompanyTimeline(companyKey, { filter: "contact_activity" });
  assert.ok(filtered.some((r) => r.id === deletedNoteId), "the filtered page keeps the tombstone too");

  const counts = await getCompanyTimelineFilterCounts(companyKey);
  assert.deepEqual([counts.all, counts.contact_activity], [1, 1], "the tombstone is not counted");
});
