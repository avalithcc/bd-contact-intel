/**
 * The "Última actividad" cell (contacts list) and the Outreach "Último contacto" cell show the NEWEST of the newest touch
 * and the LinkedIn connection date (exact tie: the touch). Invariants pinned for the same seeded person:
 *  - Outreach, the inline list path and the batched path (`getContactListRowsByIds`) render the same label and time;
 *  - that time equals `lastMessageAt` (lastContactAtSql): one value, two renderings;
 *  - the list sort and the `lastActivityDays` filter agree with the cell.
 * Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local `_e2e` database. Rows are committed (the list read uses
 * the shared pool) under a per-run suffix and removed afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const lastName = `NamedAct${run}`;
const AT = new Date("2026-10-20T10:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * day);

type Seed = { touches?: { type: string; at: Date }[]; linkedin?: Date };
type Expect = "none" | "linkedin" | "activity";
// Each person: what is seeded and which source the cell must show.
const SEEDS: Record<string, Seed & { expect: Expect; type?: string }> = {
  email_sent: { touches: [{ type: "email_sent", at: AT }, { type: "note", at: new Date("2026-09-01T10:00:00Z") }, { type: "meeting_logged", at: new Date("2026-08-01T10:00:00Z") }], linkedin: new Date("2026-01-02T00:00:00Z"), expect: "activity", type: "email_sent" },
  reply_received: { touches: [{ type: "reply_received", at: AT }], expect: "activity", type: "reply_received" },
  auto_reply_received: { touches: [{ type: "auto_reply_received", at: AT }], expect: "activity", type: "auto_reply_received" },
  none: { expect: "none" },
  linkedin_only: { linkedin: new Date("2026-10-10T10:00:00Z"), expect: "linkedin" },
  // Email 12 days before the LinkedIn message: the LinkedIn message is the "Última actividad".
  linkedin_newer: { touches: [{ type: "email_sent", at: new Date("2026-10-01T10:00:00Z") }], linkedin: new Date("2026-10-13T10:00:00Z"), expect: "linkedin" },
  touch_newer: { touches: [{ type: "email_sent", at: AT }], linkedin: new Date("2026-10-10T10:00:00Z"), expect: "activity", type: "email_sent" },
  tie: { touches: [{ type: "email_sent", at: AT }], linkedin: AT, expect: "activity", type: "email_sent" },
  // Only non-touch rows (a task, a meeting reschedule): not a touch, so LinkedIn is the fallback.
  only_nontouch: { touches: [{ type: "task_created", at: new Date("2026-10-22T10:00:00Z") }], linkedin: new Date("2026-10-10T10:00:00Z"), expect: "linkedin" },
  recent_linkedin_only: { linkedin: ago(2), expect: "linkedin" },
  old_linkedin_only: { linkedin: ago(200), expect: "linkedin" },
};
const ids: Record<string, string> = {};
const bdIds: string[] = [];

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, person, personBdConnection } = await import("@/db/schema");
  const [me] = await db.insert(bd).values({ email: `zz-na-me-${run}@example.test`, name: "ZZ me" }).returning();
  bdIds.push(me!.id);
  ids.me = me!.id;
  for (const [name, seed] of Object.entries(SEEDS)) {
    const [p] = await db.insert(person).values({ firstName: name, lastName }).returning();
    ids[name] = p!.id;
    for (const t of seed.touches ?? []) {
      await db.insert(activity).values({ personId: p!.id, actorBdId: me!.id, type: t.type, metadata: {}, createdAt: t.at });
    }
    if (seed.linkedin) {
      await db.insert(personBdConnection).values({ personId: p!.id, bdId: me!.id, messageCount: 2, lastMessageAt: seed.linkedin, reciprocal: false });
    }
  }
});

after(async () => {
  const { db } = await import("@/db");
  const { activity, bd, person, personBdConnection } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  const personIds = Object.keys(SEEDS).map((k) => ids[k]!);
  await db.delete(activity).where(inArray(activity.personId, personIds));
  await db.delete(personBdConnection).where(inArray(personBdConnection.personId, personIds));
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(bd).where(inArray(bd.id, bdIds));
  await db.$client.end();
});

async function outreach(personId: string) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { selectOutreachRows } = await import("@/lib/outreach/queries");
  const { attachOutreachReasons } = await import("@/lib/contacts/outreachView");
  const { parseDbTimestamp } = await import("@/lib/db/timestamp");
  const { es } = await import("@/lib/i18n/dictionaries/es");
  const rows = await selectOutreachRows(db, ids.me!, eq(person.id, personId), true);
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  const [mapped] = attachOutreachReasons(
    [{ ...r, lastMessageAt: null, roleGroup: null, dormant: false, isLeadership: false, relationshipTier: "never_messaged", companyDisplayName: "", openItCount: 0, offshoreItCount: 0, latamItCount: 0, offshoreHeavy: false, isStartup: null, startupReason: null, hasOwnContact: false } as never],
    () => "x",
    es as never,
  );
  return { row: r, lastActivity: mapped!.lastActivity, lastMessageAt: r.lastMessageAt == null ? null : parseDbTimestamp(r.lastMessageAt) };
}

for (const [name, seed] of Object.entries(SEEDS)) {
  test(`${name}: Outreach, inline list and batched list render the same cell, and its time is lastMessageAt`, async () => {
    const { getContactListPage, getContactListRowsByIds } = await import("@/lib/contacts/listQueries");
    const { es } = await import("@/lib/i18n/dictionaries/es");
    const list = await getContactListPage({}, ids.me!, lastName, 1, 50, es as never);
    const inline = list.rows.find((r) => r.id === ids[name])?.lastActivity ?? null;
    assert.ok(list.rows.some((r) => r.id === ids[name]), "person is in the contacts list");
    const batched = (await getContactListRowsByIds([ids[name]!], es as never))[0]?.lastActivity ?? null;
    const o = await outreach(ids[name]!);

    for (const [path, cell] of [["inline", inline], ["batched", batched], ["outreach", o.lastActivity]] as const) {
      if (seed.expect === "none") {
        assert.equal(cell, null, path);
        continue;
      }
      assert.ok(cell, `${path} has a cell`);
      const expectedLabel = seed.expect === "linkedin" ? es.contactList.lastActivityLinkedin : undefined;
      if (expectedLabel) assert.equal(cell.label, expectedLabel, path);
      assert.equal(cell.type, seed.expect === "linkedin" ? "linkedin_message" : seed.type, path);
      // The invariant, not a hard-coded date: the cell's time IS lastMessageAt.
      assert.equal(cell.createdAt.toISOString(), o.lastMessageAt?.toISOString(), path);
    }
    if (seed.expect === "none") assert.equal(o.lastMessageAt, null);
    assert.equal(inline?.label, batched?.label);
    assert.equal(inline?.label, o.lastActivity?.label);
  });
}

test("the contacts list sorts by the same value the cell shows", async () => {
  const { getContactListPage } = await import("@/lib/contacts/listQueries");
  const { es } = await import("@/lib/i18n/dictionaries/es");
  const list = await getContactListPage({}, ids.me!, lastName, 1, 50, es as never, "lastActivity");
  const times = list.rows.map((r) => r.lastActivity?.createdAt.getTime() ?? -Infinity);
  assert.equal(times.length, Object.keys(SEEDS).length);
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("lastActivityDays matches a LinkedIn-only person exactly when the cell is inside the window", async () => {
  const { getContactListPage } = await import("@/lib/contacts/listQueries");
  const { es } = await import("@/lib/i18n/dictionaries/es");
  const list = await getContactListPage({ lastActivityDays: 7 }, ids.me!, lastName, 1, 50, es as never);
  const matched = new Set(list.rows.map((r) => r.id));
  assert.ok(matched.has(ids.recent_linkedin_only!));
  assert.ok(!matched.has(ids.old_linkedin_only!));
  assert.ok(!matched.has(ids.none!));
});

test("adding the named-activity subquery leaves the LinkedIn message sum untouched", async () => {
  const o = await outreach(ids.email_sent!);
  assert.equal(o.row.messageCount, 2);
});
