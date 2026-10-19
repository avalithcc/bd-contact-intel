/**
 * DB proof of the LinkedIn connections import (2026-10-19 timeout fix): a re-import of unchanged rows writes nothing
 * (contact and person row versions, `xmin`, stay put), one changed row writes exactly that row, a 5,000-row re-import
 * takes seconds, and a person imported AFTER their messages gets the right counts and status from the finalize step.
 * Opt-in like the other files here: `npm run test:db` with DATABASE_URL on a local database named `*_e2e`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const prefix = `linkedin.com/in/zz-ci-${run}-`;
let bdId: string;

const mkRows = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    profileKey: `${prefix}${from + i}`,
    firstName: `First${from + i}`,
    lastName: `Last${run}x${from + i}`,
    company: `Acme${(from + i) % 40} Corp`,
    position: (from + i) % 3 === 0 ? "Head of Sales" : (from + i) % 59 === 58 ? null : "Software Engineer",
    email: null,
    connectedOn: "01 Jan 2025",
  }));

async function versions(): Promise<{ contacts: Map<string, string>; persons: Map<string, string> }> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const c = await db.execute<{ k: string; v: string }>(
    sql`select profile_key as k, xmin::text as v from contact where bd_id = ${bdId} and profile_key like ${prefix + "%"}`,
  );
  const p = await db.execute<{ k: string; v: string }>(
    sql`select profile_key as k, xmin::text as v from person where profile_key like ${prefix + "%"}`,
  );
  return { contacts: new Map([...c].map((r) => [r.k, r.v])), persons: new Map([...p].map((r) => [r.k, r.v])) };
}

function changedKeys(a: Map<string, string>, b: Map<string, string>): string[] {
  return [...b].filter(([k, v]) => a.get(k) !== v).map(([k]) => k);
}

before(async () => {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [row] = await db.insert(bd).values({ name: `ZZ import ${run}`, email: `zz-import-${run}@example.test` }).returning();
  bdId = row.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`delete from person_id_map where legacy_table = 'contact' and legacy_id in (select id from contact where bd_id = ${bdId})`);
  await db.execute(sql`delete from person_bd_connection where bd_id = ${bdId}`);
  await db.execute(sql`delete from person where profile_key like ${prefix + "%"}`);
  await db.execute(sql`delete from bd where id = ${bdId}`);
});

test("import, unchanged re-import and a single changed row", async () => {
  const { upsertContacts } = await import("@/lib/queries");
  const rows = mkRows(60);

  const first = await upsertContacts(bdId, rows);
  assert.equal(first.created, 60);
  assert.equal(first.updated + first.unchanged, 0);
  const v1 = await versions();
  assert.equal(v1.contacts.size, 60);
  assert.equal(v1.persons.size, 60);

  const again = await upsertContacts(bdId, rows);
  assert.deepEqual([again.created, again.updated, again.unchanged], [0, 0, 60]);
  const v2 = await versions();
  assert.deepEqual(changedKeys(v1.contacts, v2.contacts), [], "no contact rewritten");
  assert.deepEqual(changedKeys(v1.persons, v2.persons), [], "no person rewritten");

  // Row 58 was stored without a position: the person genuinely gains one.
  assert.equal(rows[58].position, null);
  const edited = rows.map((r, i) => (i === 58 ? { ...r, position: "VP Engineering" } : r));
  const third = await upsertContacts(bdId, edited);
  assert.deepEqual([third.created, third.updated, third.unchanged], [0, 1, 59]);
  const v3 = await versions();
  assert.deepEqual(changedKeys(v2.contacts, v3.contacts), [rows[58].profileKey]);
  assert.deepEqual(changedKeys(v2.persons, v3.persons), [rows[58].profileKey]);
});

test("5,000 rows: first import and unchanged re-import timings", async () => {
  const { upsertContacts } = await import("@/lib/queries");
  const rows = mkRows(5000, 1000);

  let t = performance.now();
  const first = await upsertContacts(bdId, rows);
  const firstMs = Math.round(performance.now() - t);
  assert.equal(first.created, 5000);

  const before = await versions();
  t = performance.now();
  const again = await upsertContacts(bdId, rows);
  const againMs = Math.round(performance.now() - t);
  assert.deepEqual([again.created, again.updated, again.unchanged], [0, 0, 5000]);
  const after = await versions();
  assert.deepEqual(changedKeys(before.persons, after.persons), []);
  console.log(`TIMING 5000 rows (local db): first import ${firstMs} ms, unchanged re-import ${againMs} ms`);
  assert.ok(againMs < 30_000, `re-import took ${againMs} ms`);
});

test("a person imported after their messages gets counts and status from the finalize step", async () => {
  const { db } = await import("@/db");
  const { conversation, message } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");
  const { recomputeMessageSignals, upsertContacts } = await import("@/lib/queries");

  const peer = `${prefix}late-peer`;
  const me = `linkedin.com/in/zz-me-${run}`;
  const [conv] = await db
    .insert(conversation)
    .values({ bdId, externalId: `zz-conv-${run}`, peerProfileKey: peer })
    .returning();
  const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m));
  await db.insert(message).values([
    { bdId, conversationId: conv.id, senderProfileKey: me, sentAt: at(0), content: "hi", contentHash: `h1-${run}` },
    { bdId, conversationId: conv.id, senderProfileKey: me, sentAt: at(1), content: "hello?", contentHash: `h2-${run}` },
    { bdId, conversationId: conv.id, senderProfileKey: peer, sentAt: at(2), content: "hey", contentHash: `h3-${run}` },
  ]);
  await recomputeMessageSignals(bdId); // the messages import: the peer is not a contact yet

  await upsertContacts(bdId, [
    { profileKey: peer, firstName: "Late", lastName: `Peer${run}`, company: "Acme Late", position: "CTO", email: null, connectedOn: null },
  ]);
  const read = async () =>
    (
      await db.execute<{ sent: number; received: number; reciprocal: boolean; status: string; csent: number }>(sql`
        select pbc.sent_count as sent, pbc.received_count as received, pbc.reciprocal, p.status, ct.sent_count as csent
        from contact ct
        join person_id_map pim on pim.legacy_table = 'contact' and pim.legacy_id = ct.id
        join person p on p.id = pim.person_id
        join person_bd_connection pbc on pbc.person_id = p.id and pbc.bd_id = ct.bd_id
        where ct.bd_id = ${bdId} and ct.profile_key = ${peer}`)
    )[0];
  const beforeFinalize = await read();
  assert.equal(beforeFinalize.sent, 0, "the bug: no counts until the next messages import");

  const t = performance.now();
  await recomputeMessageSignals(bdId, "unsignalled");
  console.log(`TIMING finalize (unsignalled scope, ~6,000 contacts): ${Math.round(performance.now() - t)} ms`);
  const afterFinalize = await read();
  assert.equal(afterFinalize.sent, 2);
  assert.equal(afterFinalize.received, 1);
  assert.equal(afterFinalize.csent, 2);
  assert.equal(afterFinalize.reciprocal, true);
  assert.notEqual(afterFinalize.status, beforeFinalize.status, "status recomputed from the new evidence");
});

test("signal recompute timings with 3,000 conversations / 9,000 messages over ~6,000 contacts", async () => {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { recomputeMessageSignals, upsertContacts } = await import("@/lib/queries");
  await db.execute(sql`
    insert into conversation (bd_id, external_id, peer_profile_key)
    select ${bdId}, 'zz-bulk-${sql.raw(run)}-' || g, ${prefix} || (1000 + g)
    from generate_series(0, 2999) g`);
  await db.execute(sql`
    insert into message (bd_id, conversation_id, sender_profile_key, sent_at, content, content_hash)
    select ${bdId}, c.id, case when k = 1 then c.peer_profile_key else 'me' end,
           now() - (k || ' minutes')::interval, 'm', 'bulk-${sql.raw(run)}-' || c.external_id || '-' || k
    from conversation c, generate_series(0, 2) k
    where c.bd_id = ${bdId} and c.external_id like ${"zz-bulk-" + run + "-%"}`);
  // Fresh bulk rows have no planner statistics yet (production has autovacuum); without this the join order is a guess.
  await db.execute(sql`analyze conversation`);
  await db.execute(sql`analyze message`);
  await db.execute(sql`analyze contact`);
  let t = performance.now();
  await recomputeMessageSignals(bdId);
  const allMs = Math.round(performance.now() - t);
  // new contacts imported after their messages: only these have zero signals
  await upsertContacts(bdId, mkRows(200, 20_000));
  t = performance.now();
  await recomputeMessageSignals(bdId, "unsignalled");
  const scopedMs = Math.round(performance.now() - t);
  console.log(`TIMING recompute (local db): whole-BD ${allMs} ms, unsignalled scope ${scopedMs} ms`);
  assert.ok(allMs < 30_000 && scopedMs < 30_000);
});
