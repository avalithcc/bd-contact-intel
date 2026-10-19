/**
 * The reads behind /reuniones and the contact record's strip (meeting-outcomes) against a scratch database: who sees which
 * meetings, tab counts that follow the filters, the default tab, and the edit flag. Opt-in and fail-closed: `npm run test:db`,
 * DATABASE_URL a local `_e2e` database. Every test runs in one transaction rolled back by a sentinel throw.
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

const NOW = new Date("2026-10-22T15:00:00.000Z"); // 12:00 ART

async function seed(tx: Tx) {
  const { bd, person } = await import("@/db/schema");
  const [me] = await tx.insert(bd).values({ email: "zz-page-me@example.test", name: "ZZ Me" }).returning();
  const [admin] = await tx.insert(bd).values({ email: "zz-page-admin@example.test", name: "ZZ Admin", role: "admin" }).returning();
  const [contact] = await tx.insert(person).values({ firstName: "Lucía", lastName: "Fernández", company: "Andes Labs" }).returning();
  const [other] = await tx.insert(person).values({ firstName: "Otro", lastName: "Contacto", company: "Nube Sur" }).returning();
  return { me: me!, admin: admin!, contact: contact!, other: other! };
}

test("the page read: a BD sees only their meetings, an admin sees all with filters, tab counts and the default tab follow the data", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, admin, contact, other } = await seed(tx);
    const { getMeetingPageOn } = await import("@/lib/meetings/queries");
    const { resolveMeetingScope } = await import("@/lib/meetings/view");
    const { registerContactMeeting } = await import("@/lib/meetings/db");

    // Mine: one pending, one upcoming, one held. The admin's: one upcoming.
    const earlier = new Date("2026-10-19T15:00:00.000Z");
    await registerContactMeeting(contact.id, me.id, "2026-10-22", "11:00", "pendiente", earlier, { database: tx });
    await registerContactMeeting(contact.id, me.id, "2026-10-23", "10:30", "próxima", NOW, { database: tx });
    await registerContactMeeting(contact.id, me.id, "2026-10-16", "11:00", "hecha", NOW, { database: tx });
    await registerContactMeeting(other.id, admin.id, "2026-10-24", "09:00", "del admin", NOW, { database: tx });

    const bdScope = resolveMeetingScope({ id: me.id, role: "bd" }, {}, NOW);
    const mine = await getMeetingPageOn(tx, me.id, bdScope, null, NOW);
    assert.equal(mine.view, "pending", "Por confirmar when there is any");
    assert.deepEqual(mine.counts, { pending: 1, scheduled: 1, held: 1, no_show: 0, rescheduled: 0, cancelled: 0 });
    assert.deepEqual(mine.rows.map((r) => r.notes), ["pendiente"]);
    assert.equal(mine.rows[0]!.canMutate, true);
    assert.equal(mine.rows[0]!.bdName, me.name);
    assert.equal(mine.rows[0]!.company, "Andes Labs");
    assert.equal(mine.rows[0]!.scheduledAt.toISOString(), "2026-10-22T14:00:00.000Z");
    assert.deepEqual(mine.bds, []);

    const scheduledTab = await getMeetingPageOn(tx, me.id, bdScope, "scheduled", NOW);
    assert.deepEqual(scheduledTab.rows.map((r) => r.notes), ["próxima"]);

    const adminScope = resolveMeetingScope({ id: admin.id, role: "admin" }, {}, NOW);
    const all = await getMeetingPageOn(tx, admin.id, adminScope, "scheduled", NOW);
    assert.deepEqual(all.rows.map((r) => [r.notes, r.canMutate]), [["próxima", false], ["del admin", true]], "an admin reads everyone's, changes only their own");
    assert.ok(all.bds.some((b) => b.id === me.id) && all.bds.some((b) => b.id === admin.id));

    const onlyMe = await getMeetingPageOn(tx, admin.id, resolveMeetingScope({ id: admin.id, role: "admin" }, { bd: me.id }, NOW), "scheduled", NOW);
    assert.deepEqual(onlyMe.rows.map((r) => r.notes), ["próxima"]);

    const outOfRange = await getMeetingPageOn(tx, admin.id, resolveMeetingScope({ id: admin.id, role: "admin" }, { from: "2026-09-01", to: "2026-09-30" }, NOW), "scheduled", NOW);
    assert.equal(outOfRange.rows.length, 0);
    assert.equal(outOfRange.counts.scheduled, 0, "tab counts follow the active filters");

    // A viewer with nothing pending lands on Agendadas.
    const adminOwn = await getMeetingPageOn(tx, admin.id, resolveMeetingScope({ id: admin.id, role: "bd" }, {}, NOW), null, NOW);
    assert.equal(adminOwn.view, "scheduled");
  });
});

test("a meeting later today is Agendada, not Por confirmar, until its time passes", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { getMeetingPageOn } = await import("@/lib/meetings/queries");
    const { resolveMeetingScope } = await import("@/lib/meetings/view");
    const { registerContactMeeting } = await import("@/lib/meetings/db");
    await registerContactMeeting(contact.id, me.id, "2026-10-22", "16:00", "esta tarde", NOW, { database: tx });
    const scope = resolveMeetingScope({ id: me.id, role: "bd" }, {}, NOW);
    const before = await getMeetingPageOn(tx, me.id, scope, null, NOW);
    assert.equal(before.counts.pending, 0);
    assert.equal(before.counts.scheduled, 1);
    const after = await getMeetingPageOn(tx, me.id, scope, null, new Date("2026-10-22T19:30:00.000Z"));
    assert.equal(after.view, "pending");
    assert.equal(after.counts.pending, 1);
  });
});

test("a person's scheduled meetings: a BD gets their own, an admin gets everyone's with the right edit flag", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, admin, contact } = await seed(tx);
    const { registerContactMeeting } = await import("@/lib/meetings/db");
    const { getScheduledMeetingsForPersonOn } = await import("@/lib/meetings/queries");
    await registerContactMeeting(contact.id, me.id, "2026-10-23", "10:00", "mía", NOW, { database: tx });
    await registerContactMeeting(contact.id, admin.id, "2026-10-24", "10:00", "del admin", NOW, { database: tx });
    const asMe = await getScheduledMeetingsForPersonOn(tx, contact.id, { id: me.id, role: "bd" });
    assert.deepEqual(asMe.map((m) => [m.notes, m.canMutate]), [["mía", true]]);
    const asAdmin = await getScheduledMeetingsForPersonOn(tx, contact.id, { id: admin.id, role: "admin" });
    assert.deepEqual(asAdmin.map((m) => [m.notes, m.canMutate]), [["mía", false], ["del admin", true]]);
  });
});
