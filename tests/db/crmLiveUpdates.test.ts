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

/** Who may EXECUTE the function, by role name ("public" for PUBLIC). */
async function executors(tx: Tx, fn: string): Promise<string[]> {
  const rows = [...(await run(tx, `select case when a.grantee = 0 then 'public' else a.grantee::regrole::text end as who
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.${fn}()'::regprocedure and a.privilege_type = 'EXECUTE' order by 1`))] as unknown as { who: string }[];
  return rows.map((r) => r.who);
}

async function createApiRoles(tx: Tx, roles: string[]) {
  for (const role of roles) {
    await run(tx, `do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
  }
  await run(tx, "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
}

test("the notify function is executable by its owner only, even where the API roles get EXECUTE by default", async () => {
  await inRolledBackTransaction(async (tx) => {
    await run(tx, "set local client_min_messages = warning");
    await createApiRoles(tx, ["anon", "authenticated", "service_role"]);
    await applyMigration(tx);
    const who = await executors(tx, "crm_notify_change");
    const owner = ([...(await run(tx, "select proowner::regrole::text as owner from pg_proc where oid = 'public.crm_notify_change()'::regprocedure"))] as unknown as { owner: string }[])[0]!.owner;
    assert.deepEqual(who, [owner]);
  });
});

test("a second apply leaves the existing triggers alone (no drop, so no ACCESS EXCLUSIVE) and creates all 33", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    const ids = async () => [...(await run(tx, "select oid::text as oid from pg_trigger where tgname like 'crm_notify_%' order by oid"))].map((r) => (r as unknown as { oid: string }).oid);
    const first = await ids();
    assert.equal(first.length, 33);
    await applyMigration(tx);
    assert.deepEqual(await ids(), first);
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
    await createApiRoles(tx, ["anon", "authenticated", "service_role"]);
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
    const who = await executors(tx, "crm_live_allowed");
    assert.ok(who.includes("authenticated"), "the policy runs with the querying role's privileges");
    for (const denied of ["public", "anon", "service_role"]) assert.ok(!who.includes(denied), `${denied} must not execute crm_live_allowed`);
  });
});

// --- 0058: an email_account UPDATE broadcasts only when a BD can see the change ---------------------------------------

async function applyFilterMigration(tx: Tx) {
  await run(tx, "set local client_min_messages = warning");
  const file = readFileSync("drizzle/0058_email_account_notify_filter.sql", "utf8");
  for (const chunk of file.split("--> statement-breakpoint")) await run(tx, chunk);
}

async function seedAccount(tx: Tx, tag: string, lastSyncedAgo: string | null = "1 minute") {
  const me = await seedBd(tx, tag);
  const synced = lastSyncedAgo ? `now() - interval '${lastSyncedAgo}'` : "null";
  await run(tx, `insert into email_account (bd_id, email_address, status, last_synced_at, history_id) values ('${me.id}', 'zz-live-${tag}@example.test', 'connected', ${synced}, '100')`);
  return me;
}

async function emitted(tx: Tx, statement: string): Promise<Call[]> {
  await run(tx, "delete from realtime.calls");
  await run(tx, statement);
  return calls(tx);
}

test("0058: the sync bookkeeping UPDATE (last_synced_at, history_id, backfill token, updated_at) emits nothing", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await applyFilterMigration(tx);
    await installRealtimeStub(tx);
    const me = await seedAccount(tx, "sync");
    const got = await emitted(tx, `update email_account set last_synced_at = now(), history_id = '101', backfill_page_token = 'x', updated_at = now() where bd_id = '${me.id}'`);
    assert.deepEqual(got, []);
  });
});

test("0058: every UI-visible change emits exactly once, with the owner's bdId", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await applyFilterMigration(tx);
    await installRealtimeStub(tx);
    const me = await seedAccount(tx, "vis");
    const changes = [
      "status = 'error'",
      "status = 'connected'",
      "sync_error = 'Gmail API failed'",
      "sync_error = null",
      "granted_scopes = 'gmail.send'",
      "email_address = 'zz-live-vis2@example.test'",
      "last_error_message = 'boom'",
      "connected_at = now() + interval '1 second'",
      "disconnected_at = now()",
    ];
    for (const change of changes) {
      const got = await emitted(tx, `update email_account set ${change} where bd_id = '${me.id}'`);
      assert.equal(got.length, 1, change);
      assert.deepEqual(got[0]!.payload, { kind: "email_account", op: "UPDATE", ids: {}, bdId: me.id }, change);
    }
  });
});

test("0058: the first success, and recovery from a stale sync, still emit; a fresh success does not", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await applyFilterMigration(tx);
    await installRealtimeStub(tx);
    const fresh = await seedAccount(tx, "fresh", "1 minute");
    assert.equal((await emitted(tx, `update email_account set last_synced_at = now() where bd_id = '${fresh.id}'`)).length, 0);
    const stale = await seedAccount(tx, "stale", "2 hours");
    assert.equal((await emitted(tx, `update email_account set last_synced_at = now() where bd_id = '${stale.id}'`)).length, 1);
    const never = await seedAccount(tx, "never", null);
    assert.equal((await emitted(tx, `update email_account set last_synced_at = now() where bd_id = '${never.id}'`)).length, 1);
  });
});

test("0058: INSERT and DELETE still emit; a statement with one visible row among sync-only rows emits once", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await applyFilterMigration(tx);
    await installRealtimeStub(tx);
    const a = await seedBd(tx, "ia");
    const ins = await emitted(tx, `insert into email_account (bd_id, email_address) values ('${a.id}', 'zz-live-ia@example.test')`);
    assert.deepEqual(ins.map((c) => c.payload.op), ["INSERT"]);
    const b = await seedAccount(tx, "ib");
    const mixed = await emitted(tx, `update email_account set last_synced_at = now(), status = case when bd_id = '${b.id}' then 'error' else status end`);
    assert.equal(mixed.length, 1);
    const del = await emitted(tx, `delete from email_account where bd_id = '${a.id}'`);
    assert.deepEqual(del.map((c) => c.payload.op), ["DELETE"]);
  });
});

test("0058: other tables keep notifying, and missing email_account triggers are recreated once (re-runnable)", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await installRealtimeStub(tx);
    for (const name of ["crm_notify_ins", "crm_notify_upd", "crm_notify_del"]) await run(tx, `drop trigger ${name} on email_account`);
    const oids = async () => [...(await run(tx, "select oid::text as oid from pg_trigger where tgname like 'crm_notify_%' and not tgisinternal order by oid"))].map((r) => (r as unknown as { oid: string }).oid);
    assert.equal((await oids()).length, 30);
    await applyFilterMigration(tx);
    const first = await oids();
    assert.equal(first.length, 33);
    await applyFilterMigration(tx);
    assert.deepEqual(await oids(), first);
    const me = await seedBd(tx, "other");
    const [p] = await seedPeople(tx, 1);
    const { task } = await import("@/db/schema");
    await run(tx, "delete from realtime.calls");
    await tx.insert(task).values({ personId: p!.id, assignedToBdId: me.id, title: "t" });
    assert.deepEqual((await calls(tx)).map((c) => `${c.payload.kind}:${c.payload.op}`), ["task:INSERT"]);
  });
});

test("0058: a failing realtime.send never fails a visible email_account update", async () => {
  await inRolledBackTransaction(async (tx) => {
    await applyMigration(tx);
    await applyFilterMigration(tx);
    const me = await seedBd(tx, "fail");
    await run(tx, `insert into email_account (bd_id, email_address) values ('${me.id}', 'zz-live-fail@example.test')`);
    await installRealtimeStub(tx, true);
    await run(tx, `update email_account set status = 'error' where bd_id = '${me.id}'`);
  });
});
