/**
 * DB-backed test for the extension's "En el CRM" card read (`getLinkedinPersonCard`): one statement returns the
 * person, the owner and the latest activity by EFFECTIVE time (a `status_backfill` row's metadata.originalAt, a
 * `call` row's occurredAt), skipping a soft-deleted note and non-touch rows.
 *
 * Opt-in and fail-closed like the other files here: `npm run test:db`, with DATABASE_URL pointing at a local
 * database whose name ends in `_e2e`. Everything runs in one transaction rolled back by a sentinel throw.
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

test("returns the person, the owner and the latest activity by effective time", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { activity, bd, person } = await import("@/db/schema");
    const { getLinkedinPersonCard } = await import("@/lib/extension/linkedinPersonCardQuery");
    const { getDictionary } = await import("@/lib/i18n/server");
    const [owner] = await tx.insert(bd).values({ name: "Ana Pereyra", email: "zz-card-owner@avalith.net" }).returning();
    const [p] = await tx
      .insert(person)
      .values({ firstName: "Valentina", lastName: "Rojas", jobTitle: "VP de Ingeniería", company: "Mercado Libre", ownerBdId: owner!.id })
      .returning();
    const personId = p!.id;
    // Inserted today, but the reconstructed history says 2024: must NOT win over the real call below.
    await tx.insert(activity).values({ personId, type: "status_backfill", metadata: { status: "replied", originalAt: "2024-03-01T10:00:00.000Z" } });
    await tx.insert(activity).values({ personId, type: "call", metadata: { occurredAt: "2026-10-15T14:00:00.000Z" } });
    // Newest row by created_at, but a soft-deleted note and a task edit are not touches.
    await tx.insert(activity).values({ personId, type: "note", deletedAt: new Date(), metadata: {} });
    await tx.insert(activity).values({ personId, type: "task_updated", metadata: {} });

    const card = await getLinkedinPersonCard(personId, await getDictionary(), tx);
    assert.ok(card);
    assert.equal(card.name, "Valentina Rojas");
    assert.equal(card.jobTitle, "VP de Ingeniería");
    assert.equal(card.company, "Mercado Libre");
    assert.equal(card.ownerName, "Ana Pereyra");
    assert.equal(card.lastActivity?.date, "2026-10-15T14:00:00.000Z");
    assert.ok(card.lastActivity?.label);
  });
});

test("a person with no activity and no owner has neither", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { person } = await import("@/db/schema");
    const { getLinkedinPersonCard } = await import("@/lib/extension/linkedinPersonCardQuery");
    const { getDictionary } = await import("@/lib/i18n/server");
    const [p] = await tx.insert(person).values({ firstName: "Solo", lastName: "Nombre" }).returning();
    const card = await getLinkedinPersonCard(p!.id, await getDictionary(), tx);
    assert.equal(card?.ownerName, null);
    assert.equal(card?.lastActivity, null);
  });
});

test("an unknown id finds nothing", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { getLinkedinPersonCard } = await import("@/lib/extension/linkedinPersonCardQuery");
    const { getDictionary } = await import("@/lib/i18n/server");
    assert.equal(await getLinkedinPersonCard("00000000-0000-4000-8000-00000000dead", await getDictionary(), tx), null);
  });
});
