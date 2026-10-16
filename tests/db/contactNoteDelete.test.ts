/**
 * Soft-deleting a Contact note against a real database: the row and its text stay, the marker columns record who and when,
 * only the author or an admin may do it (checked at the server boundary, softDeleteContactNote), and a deleted note stops
 * counting as a note, as last activity and as "worked today" without moving the Contact's status.
 * Opt-in and fail-closed like the other files here (`npm run test:db`, a loopback *_e2e database).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const HOUR = 60 * 60 * 1000;
let author: { id: string; role: string };
let other: { id: string; role: string };
let admin: { id: string; role: string };
let personId: string;
let olderNoteId: string;
let latestNoteId: string;
let otherBdNoteId: string;

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, person } = await import("@/db/schema");
  const bds = await db
    .insert(bd)
    .values([
      { name: "ZZ Author", email: `zz-author-${run}@example.test` },
      { name: "ZZ Other", email: `zz-other-${run}@example.test` },
      { name: "ZZ Admin", email: `zz-admin-${run}@example.test`, role: "admin" },
    ])
    .returning();
  [author, other, admin] = bds.map((b) => ({ id: b.id, role: b.role })) as typeof author[];
  const [p] = await db.insert(person).values({ firstName: "Note", lastName: run, email: `note-${run}@prospect.test`, emailNormalized: `note-${run}@prospect.test`, ownerBdId: author.id, status: "contacted" }).returning();
  personId = p!.id;
  const now = Date.now();
  const rows = await db
    .insert(activity)
    .values([
      { personId, actorBdId: author.id, type: "note", metadata: { note: "older note" }, createdAt: new Date(now - 48 * HOUR) },
      { personId, actorBdId: author.id, type: "note", metadata: { note: "latest note, pasted by mistake" }, createdAt: new Date(now - 1 * HOUR) },
      { personId, actorBdId: other.id, type: "note", metadata: { note: "the other BD's observation" }, createdAt: new Date(now - 24 * HOUR) },
    ])
    .returning();
  [olderNoteId, latestNoteId, otherBdNoteId] = rows.map((r) => r.id);
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  await db.delete(person).where(eq(person.id, personId)); // cascades activity
  await db.delete(bd).where(inArray(bd.id, [author.id, other.id, admin.id]));
});

const rowOf = async (id: string) => {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(activity).where(eq(activity.id, id)))[0]!;
};

test("another BD cannot delete a note: it throws at the server boundary and the row is untouched", async () => {
  const { softDeleteContactNote } = await import("@/lib/activity/noteDeleteDb");
  const { NoteDeleteForbiddenError } = await import("@/lib/activity/noteDelete");
  await assert.rejects(softDeleteContactNote(other, latestNoteId), NoteDeleteForbiddenError);
  const row = await rowOf(latestNoteId);
  assert.equal(row.deletedAt, null);
  assert.equal(row.deletedByBdId, null);
});

test("the author deletes: the row stays with its original text and the markers name the right actor", async () => {
  const { softDeleteContactNote } = await import("@/lib/activity/noteDeleteDb");
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const statusBefore = (await db.select().from(person).where(eq(person.id, personId)))[0]!.status;

  assert.deepEqual(await softDeleteContactNote(author, latestNoteId), { personId });

  const row = await rowOf(latestNoteId);
  assert.equal((row.metadata as { note: string }).note, "latest note, pasted by mistake", "the text is kept in the database");
  assert.ok(row.deletedAt instanceof Date);
  assert.equal(row.deletedByBdId, author.id);
  assert.equal(row.actorBdId, author.id, "the author is still recorded");
  assert.equal((await db.select().from(person).where(eq(person.id, personId)))[0]!.status, statusBefore, "a note never moves status");
});

test("deleting twice, or deleting something that is not a Contact note, is not found", async () => {
  const { softDeleteContactNote } = await import("@/lib/activity/noteDeleteDb");
  const { NoteNotFoundError } = await import("@/lib/activity/noteDelete");
  await assert.rejects(softDeleteContactNote(admin, latestNoteId), NoteNotFoundError);
  await assert.rejects(softDeleteContactNote(admin, randomUUID()), NoteNotFoundError);
});

test("an admin deletes another BD's note and is recorded as the deleter, not the author", async () => {
  const { softDeleteContactNote } = await import("@/lib/activity/noteDeleteDb");
  await softDeleteContactNote(admin, otherBdNoteId);
  const row = await rowOf(otherBdNoteId);
  assert.equal(row.deletedByBdId, admin.id);
  assert.equal(row.actorBdId, other.id);
});

test("the timeline keeps a tombstone without the text, and the note count drops", async () => {
  const { getPersonTimeline } = await import("@/lib/activity/queries");
  const page = await getPersonTimeline(personId, other.id);
  assert.equal(page.countsByType.note, 1, "only the older note still counts");
  assert.equal(page.entries.length, 3, "the two deleted notes are still in the timeline");
  const tomb = page.entries.find((e) => e.id === latestNoteId)!;
  assert.equal(tomb.metadata, null);
  assert.ok(!JSON.stringify(tomb).includes("pasted by mistake"));
  assert.equal(tomb.deleted?.byName, "ZZ Author");
  assert.equal(tomb.actorName, "ZZ Author");
  assert.equal(page.entries.find((e) => e.id === otherBdNoteId)!.deleted?.byName, "ZZ Admin");
  assert.equal(page.entries.find((e) => e.id === olderNoteId)!.deleted, null);
  const pill = await getPersonTimeline(personId, other.id, { pill: "note" });
  assert.equal(pill.countsByType.note, 1);
});

test("last activity falls back to the newest note that still exists", async () => {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  const { effectiveActivityAtSql } = await import("@/lib/contacts/effectiveActivityTime");
  const { eq, sql } = await import("drizzle-orm");
  const [row] = await db.select({ at: sql<Date | string>`max(${effectiveActivityAtSql()})` }).from(activity).where(eq(activity.personId, personId));
  const older = await rowOf(olderNoteId);
  assert.equal(new Date(row!.at).getTime(), older.createdAt.getTime());
});
