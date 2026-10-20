/**
 * Push invalidation triggers (drizzle/0056_crm_live_updates.sql) against a scratch database: the migration applies where
 * Supabase's realtime schema does not exist, a write never fails because of a notification, a statement emits ONE message
 * however many rows it touches, and the payload carries ids only (never row data). Realtime is stood in for by a stub
 * `realtime.send` that records its calls. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local `_e2e` database.
 * Every test runs in one transaction rolled back by a sentinel throw (the migration DDL included).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

async function run(tx: Tx, statement: string) {
  const { sql } = await import("drizzle-orm");
  return tx.execute(sql.raw(statement));
}

async function applyMigration(tx: Tx) {
  await run(tx, "set local client_min_messages = warning"); // the DROP ... IF EXISTS notices of a first apply
  const file = readFileSync("drizzle/0056_crm_live_updates.sql", "utf8");
  for (const chunk of file.split("--> statement-breakpoint")) await run(tx, chunk);
}

/** A stand-in for Supabase's realtime.send that records every call; `failing` makes it raise instead. */
async function installRealtimeStub(tx: Tx, failing = false) {
  await run(tx, "create schema realtime");
  await run(tx, "create table realtime.calls (payload jsonb, event text, topic text, private boolean)");
  await run(
    tx,
    `create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language plpgsql as $$
     begin ${failing ? "raise exception 'realtime is down';" : "insert into realtime.calls values (payload, event, topic, private);"} end $$`,
  );
}

interface Call {
  payload: { kind: string; op: string; ids?: Record<string, string[]>; bdId?: string; bulk?: boolean; count?: number };
  event: string;
  topic: string;
  private: boolean;
}

async function calls(tx: Tx): Promise<Call[]> {
  return [...(await run(tx, "select payload, event, topic, private from realtime.calls"))] as unknown as Call[];
}

async function seedBd(tx: Tx, tag: string) {
  const { bd } = await import("@/db/schema");
  const [row] = await tx.insert(bd).values({ email: `zz-live-${tag}@example.test`, name: `ZZ Live ${tag}` }).returning();
  return row!;
}

async function seedPeople(tx: Tx, count: number, secret = "Secretname") {
  const { person } = await import("@/db/schema");
  return tx.insert(person).values(Array.from({ length: count }, (_, i) => ({ firstName: `${secret}${i}`, lastName: "Prueba" }))).returning();
}

test("the migration applies without a realtime schema and writes keep working", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    const [p] = await seedPeople(tx, 1);
    assert.ok(p!.id);
  });
});

test("the migration is re-runnable", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await applyMigration(tx);
  });
});

test("an activity insert emits one private 'change' on topic 'crm' with ids only", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await installRealtimeStub(tx);
    const me = await seedBd(tx, "a");
    const [p] = await seedPeople(tx, 1);
    await run(tx, "delete from realtime.calls");
    const { activity } = await import("@/db/schema");
    await tx.insert(activity).values({ personId: p!.id, actorBdId: me.id, type: "note", metadata: { text: "Confidential body" } });
    const got = await calls(tx);
    assert.equal(got.length, 1);
    assert.equal(got[0]!.event, "change");
    assert.equal(got[0]!.topic, "crm");
    assert.equal(got[0]!.private, true);
    assert.deepEqual(got[0]!.payload, { kind: "activity", op: "INSERT", ids: { personId: [p!.id] }, bdId: me.id });
  });
});

test("the payload never carries row data", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await installRealtimeStub(tx);
    const me = await seedBd(tx, "pii");
    const [p] = await seedPeople(tx, 1, "Leakyname");
    const { activity, task } = await import("@/db/schema");
    await tx.insert(activity).values({ personId: p!.id, actorBdId: me.id, type: "note", metadata: { text: "Leakybody" } });
    await tx.insert(task).values({ personId: p!.id, assignedToBdId: me.id, title: "Leakytitle" });
    const got = await calls(tx);
    assert.ok(got.length >= 3);
    const text = JSON.stringify(got);
    for (const secret of ["Leakyname", "Leakybody", "Leakytitle", "example.test", "ZZ Live"]) assert.ok(!text.includes(secret), `payload leaks ${secret}`);
    const allowed = new Set(["kind", "op", "ids", "bdId", "bulk", "count"]);
    for (const c of got) for (const k of Object.keys(c.payload)) assert.ok(allowed.has(k), `unexpected payload key ${k}`);
  });
});

test("a bulk statement emits ONE message: a few distinct ids are listed, past 50 it collapses to bulk + count", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await installRealtimeStub(tx);
    const people = await seedPeople(tx, 60);
    const { activity } = await import("@/db/schema");
    await run(tx, "delete from realtime.calls");
    await tx.insert(activity).values(people.slice(0, 3).flatMap((p) => [0, 1, 2, 3].map(() => ({ personId: p.id, type: "note" }))));
    let got = await calls(tx);
    assert.equal(got.length, 1);
    assert.equal(got[0]!.payload.ids!.personId!.length, 3);
    await run(tx, "delete from realtime.calls");
    await tx.insert(activity).values(people.map((p) => ({ personId: p.id, type: "note" })));
    got = await calls(tx);
    assert.equal(got.length, 1);
    assert.deepEqual(got[0]!.payload, { kind: "activity", op: "INSERT", bulk: true, count: 60 });
  });
});

test("update and delete emit their own op; an update that matches no row emits nothing", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await installRealtimeStub(tx);
    const me = await seedBd(tx, "u");
    const [p] = await seedPeople(tx, 1);
    const { task } = await import("@/db/schema");
    const [t] = await tx.insert(task).values({ personId: p!.id, assignedToBdId: me.id, title: "t" }).returning();
    await run(tx, "delete from realtime.calls");
    await run(tx, `update task set status = 'done' where id = '${t!.id}'`);
    await run(tx, "update task set status = 'done' where false");
    await run(tx, `delete from task where id = '${t!.id}'`);
    const got = await calls(tx);
    assert.deepEqual(got.map((c) => c.payload.op), ["UPDATE", "DELETE"]);
    assert.deepEqual(got[0]!.payload.ids, { personId: [p!.id], taskId: [t!.id] });
  });
});

test("a sequence draft resolves its sequence and contact through the member", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await installRealtimeStub(tx);
    const me = await seedBd(tx, "s");
    const [p] = await seedPeople(tx, 1);
    const { emailAccount, sequence, sequenceMember, sequenceDraft } = await import("@/db/schema");
    const [acct] = await tx.insert(emailAccount).values({ bdId: me.id, emailAddress: "zz-live-s@example.test" } as typeof emailAccount.$inferInsert).returning();
    const [seq] = await tx.insert(sequence).values({ name: "s", ownerBdId: me.id, emailAccountId: acct!.id, schedule: {} }).returning();
    const [member] = await tx.insert(sequenceMember).values({ sequenceId: seq!.id, personId: p!.id, state: "pending" }).returning();
    await run(tx, "delete from realtime.calls");
    await tx.insert(sequenceDraft).values({ sequenceMemberId: member!.id, step: 1, subject: "Leakysubject", body: "Leakybody" });
    const got = await calls(tx);
    assert.deepEqual(got.map((c) => c.payload), [{ kind: "sequence_draft", op: "INSERT", ids: { personId: [p!.id], sequenceId: [seq!.id] } }]);
  });
});

test("a failing realtime.send never fails or rolls back the write", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await installRealtimeStub(tx, true);
    const [p] = await seedPeople(tx, 1);
    const { activity } = await import("@/db/schema");
    const [row] = await tx.insert(activity).values({ personId: p!.id, type: "note" }).returning();
    assert.ok(row!.id);
  });
});

test("an ON CONFLICT upsert still writes and notifies", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await installRealtimeStub(tx);
    await run(tx, "insert into company (company_key, display_name) values ('zz-live.test', 'ZZ Live Co')");
    await run(tx, "insert into company (company_key, display_name) values ('zz-live.test', 'ZZ Live Co 2') on conflict (company_key) do update set display_name = excluded.display_name");
    const got = await calls(tx);
    assert.deepEqual(got.map((c) => `${c.payload.kind}:${c.payload.op}`), ["company:INSERT", "company:UPDATE"]);
    assert.deepEqual(got[1]!.payload.ids, { companyKey: ["zz-live.test"] });
  });
});

test("the receive policy admits a confirmed, allowed-domain BD on topic 'crm' and nobody else", async () => {
  await inRolledBackTransaction(async (tx) => {
    await run(tx, "set local client_min_messages = warning");
    await run(tx, "do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$");
    await run(tx, "create schema auth");
    await run(tx, "create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz)");
    await run(tx, "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$");
    await run(tx, "create schema realtime");
    await run(tx, "create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$");
    await run(tx, "create table realtime.messages (id serial primary key, topic text, extension text)");
    await run(tx, "alter table realtime.messages enable row level security");
    await run(tx, "grant usage on schema realtime, auth to authenticated");
    await run(tx, "grant select on realtime.messages to authenticated");
    await run(tx, "grant execute on function realtime.topic() to authenticated");
    await run(tx, "insert into realtime.messages (topic, extension) values ('crm', 'broadcast')");
    const users: Record<string, string> = {
      ok: "00000000-0000-0000-0000-000000000001",
      unconfirmed: "00000000-0000-0000-0000-000000000002",
      otherDomain: "00000000-0000-0000-0000-000000000003",
      lookalike: "00000000-0000-0000-0000-000000000004",
      deleted: "00000000-0000-0000-0000-000000000005",
      banned: "00000000-0000-0000-0000-000000000006",
    };
    await run(
      tx,
      `insert into auth.users values
      ('${users.ok}', 'Someone@Avalith.net', now(), null, null),
      ('${users.unconfirmed}', 'a@avalith.net', null, null, null),
      ('${users.otherDomain}', 'a@gmail.com', now(), null, null),
      ('${users.lookalike}', 'a@avalith.net.evil.com', now(), null, null),
      ('${users.deleted}', 'd@avalith.net', now(), now(), null),
      ('${users.banned}', 'b@avalith.net', now(), null, now() + interval '1 day')`,
    );
    await applyMigration(tx);
    const seen = async (sub: string | null, topic: string) => {
      await run(tx, "set local role authenticated");
      await run(tx, `select set_config('request.jwt.claim.sub', '${sub ?? ""}', true), set_config('realtime.topic', '${topic}', true)`);
      const rows = [...(await run(tx, "select id from realtime.messages"))];
      await run(tx, "reset role");
      return rows.length;
    };
    assert.equal(await seen(users.ok!, "crm"), 1);
    assert.equal(await seen(users.ok!, "other"), 0);
    for (const k of ["unconfirmed", "otherDomain", "lookalike", "deleted", "banned"]) assert.equal(await seen(users[k]!, "crm"), 0, k);
    assert.equal(await seen(null, "crm"), 0);
    const policies = [...(await run(tx, "select cmd from pg_policies where schemaname = 'realtime' and tablename = 'messages'"))] as unknown as { cmd: string }[];
    assert.deepEqual(policies.map((p) => p.cmd), ["SELECT"]);
  });
});
