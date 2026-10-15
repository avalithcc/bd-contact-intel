import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  DEV_DOTENV_FILES,
  assertLocalDevTargets,
  dotenvEnablesOptOut,
  isLoopbackUrl,
  remoteDevTargets,
} from "../../src/lib/dev/localDevGuard";
import { checkLocalDevTargets, readDevDotenvFiles } from "../../src/lib/dev/localDevCheck";
import {
  SEED_TRUNCATED_TABLES,
  cascadeTablesQuery,
  missingSeedTables,
  occupiedTables,
  occupiedTablesQuery,
  truncateStatement,
} from "../../src/lib/dev/seedTables";
import { isLocalServerAddress, serverLocalityRefusal } from "../../src/lib/dev/serverLocality";
import { buildServerEnv } from "../e2e/supabaseIsolation";
import { buildLocalDevEnv, localDevOverrides, shellLeakKeys } from "../../src/lib/dev/localDevEnv";
import { assertLocalSeedDatabaseUrl, assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

const REMOTE_DB = "postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:5432/postgres";
const dev = { NODE_ENV: "development" };

test("loopback hosts only", () => {
  for (const u of ["postgres://localhost:5432/x", "http://127.0.0.1:54321", "postgres://[::1]/x"]) assert.equal(isLoopbackUrl(u), true, u);
  for (const u of [REMOTE_DB, "https://abc.supabase.co", "not a url", "", "http://localhost.evil.com"]) assert.equal(isLoopbackUrl(u), false, u);
});

test("dev with a remote DATABASE_URL or Supabase URL is refused, naming the variable only", () => {
  const env = { ...dev, DATABASE_URL: REMOTE_DB, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" };
  assert.deepEqual(remoteDevTargets(env), ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  assert.throws(() => assertLocalDevTargets(env), (e: Error) => e.message.includes("DATABASE_URL") && !e.message.includes("pooler"));
});

test("loopback or unset values pass in dev", () => {
  assert.doesNotThrow(() => assertLocalDevTargets({ ...dev, DATABASE_URL: "postgres://localhost:5432/bd_contact_intel_dev" }));
  assert.doesNotThrow(() => assertLocalDevTargets(dev));
});

test("production, test and unset NODE_ENV are never judged", () => {
  for (const NODE_ENV of ["production", "test", undefined]) {
    assert.deepEqual(remoteDevTargets({ NODE_ENV, DATABASE_URL: REMOTE_DB }), []);
  }
});

test("explicit opt-out allows a remote target in dev, only with 1", () => {
  assert.deepEqual(remoteDevTargets({ ...dev, DATABASE_URL: REMOTE_DB, ALLOW_REMOTE_DB_IN_DEV: "1" }), []);
  assert.deepEqual(remoteDevTargets({ ...dev, DATABASE_URL: REMOTE_DB, ALLOW_REMOTE_DB_IN_DEV: "true" }), ["DATABASE_URL"]);
});

test("buildLocalDevEnv blanks dotenv keys, keeps AI Gateway keys unset, forces local targets, and is pure", () => {
  const keys = ["DATABASE_URL", "GMAIL_TOKEN_ENCRYPTION_KEY", "CRON_SECRET", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "SOMETHING_NEW"];
  const snapshot = [...keys];
  const a = buildLocalDevEnv(keys);
  assert.deepEqual(keys, snapshot);
  assert.deepEqual(buildLocalDevEnv(keys), a);
  assert.equal(a.GMAIL_TOKEN_ENCRYPTION_KEY, "");
  assert.equal(a.CRON_SECRET, "");
  assert.equal(a.SOMETHING_NEW, "");
  assert.equal("AI_GATEWAY_API_KEY" in a, false);
  assert.equal("VERCEL_OIDC_TOKEN" in a, false);
  assert.equal(a.DATABASE_URL, localDevOverrides().DATABASE_URL);
  assert.equal(remoteDevTargets({ ...dev, ...a }).length, 0);
});

test("shellLeakKeys flags risky shell variables only", () => {
  assert.deepEqual(shellLeakKeys({ PATH: "x", DATABASE_URL: "x", GMAIL_X: "y", HOME: "z" }).sort(), ["DATABASE_URL", "GMAIL_X"]);
});

test("seed guard accepts the local dev DB but never remote hosts or other names", () => {
  assert.doesNotThrow(() => assertLocalSeedDatabaseUrl("postgres://localhost:5432/bd_contact_intel_dev"));
  assert.doesNotThrow(() => assertLocalSeedDatabaseUrl("postgres://localhost:5432/bd_contact_intel_e2e"));
  assert.throws(() => assertLocalSeedDatabaseUrl("postgres://db.supabase.co:5432/bd_contact_intel_dev"));
  assert.throws(() => assertLocalSeedDatabaseUrl("postgres://localhost:5432/postgres"));
  assert.throws(() => assertLocalSeedDatabaseUrl(undefined));
  // The Playwright guard keeps refusing the dev DB.
  assert.throws(() => assertScratchDatabaseUrl("postgres://localhost:5432/bd_contact_intel_dev"));
});

// --- opt-out must come from the real environment, never a dotenv file ---

test("an opt-out defined in a dotenv file is not honoured, and the message says so", () => {
  const env = { ...dev, DATABASE_URL: REMOTE_DB, ALLOW_REMOTE_DB_IN_DEV: "1" };
  assert.deepEqual(remoteDevTargets(env, true), ["DATABASE_URL"]);
  assert.throws(
    () => assertLocalDevTargets(env, true),
    (e: Error) => /dotenv file, which does not count/.test(e.message) && /in the shell/.test(e.message) && !e.message.includes("pooler"),
  );
  // Typed in the shell (nothing in any file) it still works.
  assert.doesNotThrow(() => assertLocalDevTargets(env, false));
});

test("refusal without any opt-out explains that a dotenv file cannot enable it", () => {
  assert.throws(() => assertLocalDevTargets({ ...dev, DATABASE_URL: REMOTE_DB }), /dotenv file cannot enable it/);
});

test("dotenvEnablesOptOut reads real parseEnv output and ignores other values and keys", () => {
  const parse = (text: string) => parseEnv(text);
  assert.equal(dotenvEnablesOptOut([parse("ALLOW_REMOTE_DB_IN_DEV=1\n")]), true);
  assert.equal(dotenvEnablesOptOut([{}, parse('A=b\nALLOW_REMOTE_DB_IN_DEV="1"\n')]), true);
  assert.equal(dotenvEnablesOptOut([parse("ALLOW_REMOTE_DB_IN_DEV=0\n"), parse("OTHER=1\n"), {}]), false);
  assert.equal(dotenvEnablesOptOut([]), false);
});

test("checkLocalDevTargets reads the dev dotenv files from the project root", () => {
  const root = mkdtempSync(path.join(tmpdir(), "localdev-"));
  const saved = { ...process.env };
  try {
    assert.equal(readDevDotenvFiles(root).length, DEV_DOTENV_FILES.length);
    Object.assign(process.env, { NODE_ENV: "development", DATABASE_URL: REMOTE_DB, ALLOW_REMOTE_DB_IN_DEV: "1" });
    // Shell only: allowed.
    assert.doesNotThrow(() => checkLocalDevTargets(root));
    // The same value also present in .env.local: refused.
    writeFileSync(path.join(root, ".env.local"), "ALLOW_REMOTE_DB_IN_DEV=1\n");
    assert.throws(() => checkLocalDevTargets(root), /dotenv file, which does not count/);
    // Outside development nothing is read or judged.
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    assert.doesNotThrow(() => checkLocalDevTargets(root));
  } finally {
    for (const k of ["NODE_ENV", "DATABASE_URL", "ALLOW_REMOTE_DB_IN_DEV"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(root, { recursive: true, force: true });
  }
});

// --- Playwright-started servers (scratch e2e on :3101, launch-readiness on :3100) ---

test("the env buildServerEnv gives a Playwright-started dev server passes the guard even with a remote Supabase project", () => {
  const input = {
    databaseUrl: "postgres://localhost:5432/bd_contact_intel_e2e",
    supabase: { url: "https://throwaway.supabase.co", anonKey: "k" },
    dotenvKeys: ["ALLOW_REMOTE_DB_IN_DEV", "GMAIL_TOKEN_ENCRYPTION_KEY"],
  };
  const env = buildServerEnv(input);
  assert.deepEqual(remoteDevTargets({ ...dev, ...env }), []);
  assert.equal(remoteDevTargets({ ...dev, ...env }, true).join(), "NEXT_PUBLIC_SUPABASE_URL");
  // Pure: same input, same output, input untouched.
  assert.deepEqual(buildServerEnv(input), env);
  assert.deepEqual(input.dotenvKeys, ["ALLOW_REMOTE_DB_IN_DEV", "GMAIL_TOKEN_ENCRYPTION_KEY"]);
});

// --- dev-setup emptiness check covers every table the seed truncates ---

test("the seed truncates exactly the listed tables, and the check is built from the same list", () => {
  assert.equal(SEED_TRUNCATED_TABLES.length, 8);
  const stmt = truncateStatement();
  for (const t of SEED_TRUNCATED_TABLES) assert.match(stmt, new RegExp(`\\b${t}\\b`));
  assert.match(stmt, /cascade$/);
  const q = cascadeTablesQuery();
  for (const t of SEED_TRUNCATED_TABLES) assert.ok(q.includes(`'${t}'`), t);
  assert.match(q, /confrelid/);
});

test("a database with 0 people but data in any other seeded table is not empty", () => {
  const tables = [...SEED_TRUNCATED_TABLES];
  const q = occupiedTablesQuery(tables);
  assert.equal((q.match(/exists\(/g) ?? []).length, tables.length);
  const rowWith = (filled: string) => Object.fromEntries(tables.map((t, i) => [`t${i}`, t === filled]));
  for (const t of tables) assert.deepEqual(occupiedTables(tables, rowWith(t)), [t], t);
  assert.deepEqual(occupiedTables(tables, rowWith("none")), []);
  assert.deepEqual(occupiedTables(tables, {}), []);
});

test("occupancy planners do not mutate their input", () => {
  const tables = ["person", "gmail_message"];
  const copy = [...tables];
  assert.equal(occupiedTablesQuery(tables), occupiedTablesQuery(tables));
  assert.deepEqual(occupiedTables(tables, { t1: true }), occupiedTables(tables, { t1: true }));
  assert.deepEqual(tables, copy);
});

test("missingSeedTables flags an unmigrated database", () => {
  assert.deepEqual(missingSeedTables([...SEED_TRUNCATED_TABLES, "extra"]), []);
  assert.deepEqual(missingSeedTables(["person"]).includes("audit_log"), true);
});

// --- the Postgres SERVER must be local before any drop/create ---

test("server address: NULL and loopback are local, anything else is remote", () => {
  for (const a of [null, "127.0.0.1", "127.0.0.1/32", "::1", "::1/128", "127.1.2.3", "::ffff:127.0.0.1"]) assert.equal(isLocalServerAddress(a), true, String(a));
  for (const a of ["10.0.0.5", "203.0.113.9", "2001:db8::1", "128.0.0.1", "", "127.0.0.1.evil", undefined]) assert.equal(isLocalServerAddress(a), false, String(a));
});

test("a remote server is refused with the tunnel scenario, database and version, and a local one passes", () => {
  const id = { addr: "203.0.113.9", db: "postgres", version: "PostgreSQL 16.4 on x86_64" };
  const copy = { ...id };
  const msg = serverLocalityRefusal(id)!;
  assert.match(msg, /SSH tunnel/);
  assert.ok(msg.includes('"postgres"') && msg.includes("PostgreSQL 16.4") && msg.includes("203.0.113.9"));
  assert.equal(serverLocalityRefusal(id), msg);
  assert.deepEqual(id, copy);
  assert.equal(serverLocalityRefusal({ ...id, addr: null }), null);
  assert.equal(serverLocalityRefusal({ ...id, addr: "127.0.0.1" }), null);
  assert.equal(serverLocalityRefusal({ ...id, addr: "::1" }), null);
});

test("an unreadable dotenv file stops the guard with its own message, never as no opt-out", () => {
  const root = mkdtempSync(path.join(tmpdir(), "localdev-"));
  const saved = { ...process.env };
  try {
    mkdirSync(path.join(root, ".env")); // a DIRECTORY named .env: readFileSync throws EISDIR
    assert.throws(() => readDevDotenvFiles(root), (e: Error) => /cannot read \.env \(EISDIR\)/.test(e.message) && !e.message.includes("\n"));
    Object.assign(process.env, { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/x" });
    assert.throws(() => checkLocalDevTargets(root), /Refusing to start: cannot read \.env/);
  } finally {
    for (const k of ["NODE_ENV", "DATABASE_URL"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(root, { recursive: true, force: true });
  }
});
