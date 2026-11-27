/**
 * "Contacto previo" against a scratch database. Everything is seeded INSIDE one transaction that is rolled back, so
 * nothing is committed. Invariants:
 *  - a status_backfill with NO actor never reads as a person: the owner is the answer;
 *  - an attributed email_sent beats the owner;
 *  - a task_* row is not a touch (effectiveActivityAtSql is NULL for it), even with an actor and a newer created_at;
 *  - a LinkedIn connection with sent_count > 0 beats the owner and loses to a NEWER activity touch;
 *  - the correlated subquery cannot fan out the row's messageCount.
 * Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local `_e2e` database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
class Rollback extends Error {}

type Seeded = { raw: unknown; ownerBdId: string | null; ownerName: string | null; messageCount: number; rows: number };

async function inRolledBackTx(fn: (h: {
  ana: string;
  bob: string;
  cris: string;
  person: (owner?: string | null) => Promise<string>;
  activity: (personId: string, type: string, actor: string | null, at: string, metadata?: object) => Promise<void>;
  linkedin: (personId: string, bdId: string, at: string | null, sent: number, messages?: number) => Promise<void>;
  read: (personId: string) => Promise<Seeded>;
}) => Promise<void>) {
  const { db } = await import("@/db");
  const { activity, bd, person, personBdConnection } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { selectOutreachRows } = await import("@/lib/outreach/queries");
  try {
    await db.transaction(async (tx) => {
      const [ana, bob, cris] = await tx
        .insert(bd)
        .values(["ana", "bob", "cris"].map((n) => ({ email: `zz-pc-${n}-${run}@example.test`, name: n })))
        .returning();
      await fn({
        ana: ana!.id,
        bob: bob!.id,
        cris: cris!.id,
        person: async (owner = null) => {
          const [p] = await tx.insert(person).values({ firstName: "Pc", lastName: `PrevContact${run}`, ownerBdId: owner }).returning();
          return p!.id;
        },
        activity: async (personId, type, actor, at, metadata = {}) => {
          await tx.insert(activity).values({ personId, actorBdId: actor, type, metadata, createdAt: new Date(at) });
        },
        linkedin: async (personId, bdId, at, sent, messages = sent) => {
          await tx.insert(personBdConnection).values({
            personId, bdId, sentCount: sent, messageCount: messages, lastMessageAt: at ? new Date(at) : null,
          });
        },
        read: async (personId) => {
          const rows = await selectOutreachRows(tx as unknown as typeof db, ana!.id, eq(person.id, personId), true);
          return { raw: rows[0]?.previousContactRaw ?? null, ownerBdId: rows[0]?.ownerBdId ?? null, ownerName: rows[0]?.ownerName ?? null, messageCount: rows[0]?.messageCount ?? -1, rows: rows.length };
        },
      });
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

async function resolve(s: Seeded) {
  const { resolvePreviousContact } = await import("@/lib/outreach/previousContact");
  const { t } = await import("@/lib/i18n/dictionaries");
  return resolvePreviousContact(s.raw as never, { bdId: s.ownerBdId, name: s.ownerName }, t("es"));
}

test.after(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});

test("a status_backfill with no actor never reads as a person: the owner is the answer", async () => {
  await inRolledBackTx(async (h) => {
    const p = await h.person(h.cris);
    await h.activity(p, "status_backfill", null, "2025-03-01T10:00:00Z", { status: "contacted", originalAt: "2024-05-01T10:00:00Z" });
    const s = await h.read(p);
    assert.equal(s.raw, null);
    const r = await resolve(s);
    assert.equal(r?.name, "cris");
    assert.equal(r?.label, "Dueño");
  });
});

test("an attributed email_sent beats the owner", async () => {
  await inRolledBackTx(async (h) => {
    const p = await h.person(h.cris);
    await h.activity(p, "email_sent", h.ana, "2026-11-12T15:00:00Z");
    const s = await h.read(p);
    const r = await resolve(s);
    assert.equal(r?.name, "ana");
    assert.equal(r?.label, "Correo enviado");
    assert.equal(r?.at?.toISOString(), "2026-11-12T15:00:00.000Z");
  });
});

test("a task_created with an actor is not a touch: it falls through to the owner", async () => {
  await inRolledBackTx(async (h) => {
    const p = await h.person(h.cris);
    await h.activity(p, "task_created", h.bob, "2026-11-20T10:00:00Z");
    await h.activity(p, "task_completed", h.bob, "2026-11-21T10:00:00Z");
    const s = await h.read(p);
    assert.equal(s.raw, null);
    assert.equal((await resolve(s))?.name, "cris");
  });
});

test("a task row newer than a real touch never shadows it", async () => {
  await inRolledBackTx(async (h) => {
    const p = await h.person();
    await h.activity(p, "email_sent", h.ana, "2026-10-01T10:00:00Z");
    await h.activity(p, "task_created", h.bob, "2026-11-20T10:00:00Z");
    assert.equal((await resolve(await h.read(p)))?.name, "ana");
  });
});

test("LinkedIn with sent_count > 0 beats the owner and loses to a newer activity touch", async () => {
  await inRolledBackTx(async (h) => {
    const onlyLi = await h.person(h.cris);
    await h.linkedin(onlyLi, h.bob, "2026-09-01T10:00:00Z", 2);
    const r1 = await resolve(await h.read(onlyLi));
    assert.equal(r1?.name, "bob");
    assert.equal(r1?.label, "Mensaje de LinkedIn");

    const newer = await h.person(h.cris);
    await h.linkedin(newer, h.bob, "2026-09-01T10:00:00Z", 2);
    await h.activity(newer, "email_sent", h.ana, "2026-10-01T10:00:00Z");
    assert.equal((await resolve(await h.read(newer)))?.name, "ana");

    const older = await h.person(h.cris);
    await h.linkedin(older, h.bob, "2026-11-01T10:00:00Z", 2);
    await h.activity(older, "email_sent", h.ana, "2026-10-01T10:00:00Z");
    assert.equal((await resolve(await h.read(older)))?.name, "bob");
  });
});

test("a connection that never sent (sent_count 0) is not contact", async () => {
  await inRolledBackTx(async (h) => {
    const p = await h.person(h.cris);
    await h.linkedin(p, h.bob, "2026-11-01T10:00:00Z", 0, 3);
    const s = await h.read(p);
    assert.equal(s.raw, null);
    assert.equal((await resolve(s))?.label, "Dueño");
  });
});

test("a person with several connections and activities stays one row and keeps messageCount", async () => {
  await inRolledBackTx(async (h) => {
    const p = await h.person();
    await h.linkedin(p, h.ana, "2026-09-01T10:00:00Z", 2, 3);
    await h.linkedin(p, h.bob, "2026-09-05T10:00:00Z", 1, 4);
    await h.activity(p, "email_sent", h.ana, "2026-08-01T10:00:00Z");
    await h.activity(p, "note", h.bob, "2026-08-02T10:00:00Z");
    const s = await h.read(p);
    assert.equal(s.rows, 1);
    assert.equal(s.messageCount, 7);
    // Newest of everything is bob's LinkedIn connection (2026-09-05).
    assert.equal((await resolve(s))?.name, "bob");
  });
});

test("types that reached nobody never name a previous contact: the owner wins", async () => {
  for (const type of ["lusha_reveal", "email_bounced", "auto_reply_received", "call_attempt", "status_change"]) {
    await inRolledBackTx(async (h) => {
      const p = await h.person(h.cris);
      await h.activity(p, type, h.bob, "2026-11-20T10:00:00Z");
      const s = await h.read(p);
      assert.equal(s.raw, null, type);
      const r = await resolve(s);
      assert.equal(r?.name, "cris", type);
      assert.equal(r?.label, "Dueño", type);
    });
  }
  await inRolledBackTx(async (h) => {
    const p = await h.person(h.cris);
    await h.activity(p, "lusha_reveal", h.bob, "2026-11-25T10:00:00Z");
    await h.activity(p, "email_sent", h.ana, "2026-11-01T10:00:00Z");
    assert.equal((await resolve(await h.read(p)))?.name, "ana");
  });
});

test("the rendered date is the effective time, not created_at, and newest-wins compares on it", async () => {
  await inRolledBackTx(async (h) => {
    const p = await h.person();
    // The Gmail sync shape: inserted "now" (created_at 2026-11-20) for a message sent months ago.
    await h.activity(p, "email_sent", h.ana, "2026-11-20T10:00:00Z", { occurredAt: "2026-07-01T09:00:00Z" });
    // A LinkedIn message between the two: newer than occurredAt, older than created_at.
    await h.linkedin(p, h.bob, "2026-09-15T10:00:00Z", 1);
    const r = await resolve(await h.read(p));
    // On the effective time LinkedIn (Sep) beats the email (Jul); on created_at the email (Nov) would win.
    assert.equal(r?.name, "bob");
    assert.equal(r?.at?.toISOString(), "2026-09-15T10:00:00.000Z");

    const alone = await h.person();
    await h.activity(alone, "email_sent", h.ana, "2026-11-20T10:00:00Z", { occurredAt: "2026-07-01T09:00:00Z" });
    const r2 = await resolve(await h.read(alone));
    assert.equal(r2?.name, "ana");
    assert.equal(r2?.at?.toISOString(), "2026-07-01T09:00:00.000Z");
  });
});

test("nothing at all is no record", async () => {
  await inRolledBackTx(async (h) => {
    const s = await h.read(await h.person());
    assert.equal(await resolve(s), null);
  });
});
