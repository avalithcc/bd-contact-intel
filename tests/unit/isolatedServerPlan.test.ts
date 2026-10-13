import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SERVER_ENV_ALLOWLIST,
  SHARED_SUPABASE_HATCH,
  planIsolatedServer,
  scratchDatabaseUrlFromFile,
} from "../e2e/supabaseIsolation";
import { readDotenvFiles } from "../e2e/dotenvFiles";

const APP = "https://appproject.example.test";
const APP_KEY = "app-anon";
const LOCAL = "http://127.0.0.1:54321";
const LOCAL_KEY = "local-anon";
const DB = "postgres://localhost:5432/x_e2e";

const base = {
  label: "launch-readiness",
  databaseUrl: DB,
  appUrl: APP,
  appAnonKey: APP_KEY,
  serverIsOurs: true,
  dotenvKeys: ["DATABASE_URL", "GMAIL_TOKEN_ENCRYPTION_KEY", "NEXT_PUBLIC_SUPABASE_URL"],
};

test("without a named project the shared one is refused, and the refusal carries the caller's label", () => {
  const plan = planIsolatedServer(base);
  assert.equal(plan.serverEnv, null);
  assert.match(plan.refusal ?? "", /^\[launch-readiness\] Refusing to run/);
  assert.match(plan.refusal ?? "", new RegExp(SHARED_SUPABASE_HATCH));
  assert.ok(!(plan.refusal ?? "").includes(APP) && !(plan.refusal ?? "").includes(APP_KEY));
});

test("a dedicated project yields the allowlisted server env with every other dotenv key blanked", () => {
  const plan = planIsolatedServer({ ...base, e2eUrl: LOCAL, e2eAnonKey: LOCAL_KEY });
  assert.equal(plan.refusal, null);
  assert.equal(plan.notice, null);
  const env = plan.serverEnv!;
  assert.equal(env.DATABASE_URL, DB);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, LOCAL);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, LOCAL_KEY);
  assert.equal(env.GMAIL_TOKEN_ENCRYPTION_KEY, "");
  assert.deepEqual(
    Object.keys(env).filter((k) => env[k] !== "").sort(),
    [...SERVER_ENV_ALLOWLIST].sort(),
  );
});

test("the hatch gives the shared project plus a notice naming the label", () => {
  const plan = planIsolatedServer({ ...base, hatch: "1" });
  assert.equal(plan.refusal, null);
  assert.equal(plan.serverEnv!.NEXT_PUBLIC_SUPABASE_URL, APP);
  assert.match(plan.notice ?? "", /SHARED Supabase project/);
});

test("a dedicated project is refused for a server the run did not start", () => {
  const plan = planIsolatedServer({ ...base, e2eUrl: LOCAL, e2eAnonKey: LOCAL_KEY, serverIsOurs: false });
  assert.match(plan.refusal ?? "", /^\[launch-readiness\] .*server the suite starts itself/);
});

test("with no database url (read-only mode) the judgement still runs but no server env is built", () => {
  const plan = planIsolatedServer({ ...base, databaseUrl: undefined, hatch: "1" });
  assert.equal(plan.refusal, null);
  assert.equal(plan.serverEnv, null);
});

test("planIsolatedServer does not mutate its input and is repeatable", () => {
  const input = { ...base, e2eUrl: LOCAL, e2eAnonKey: LOCAL_KEY };
  const copy = structuredClone(input);
  assert.deepEqual(planIsolatedServer(input), planIsolatedServer(input));
  assert.deepEqual(input, copy);
});

test("the scratch file may supply DATABASE_URL, never over the shell, never anything else", () => {
  const file = { DATABASE_URL: DB, GOOGLE_OAUTH_CLIENT_SECRET: "s", E2E_EMAIL: "a@b.c" };
  assert.deepEqual(scratchDatabaseUrlFromFile(file, {}), { DATABASE_URL: DB });
  assert.deepEqual(scratchDatabaseUrlFromFile(file, { DATABASE_URL: "postgres://shell/y_e2e" }), {});
  assert.deepEqual(scratchDatabaseUrlFromFile({ E2E_EMAIL: "a@b.c" }, {}), {});
  const copy = structuredClone(file);
  scratchDatabaseUrlFromFile(file, {});
  assert.deepEqual(file, copy);
});

test("readDotenvFiles reads the named files in order and treats a missing file as empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "dotenv-"));
  writeFileSync(join(dir, ".env.e2e.local"), "A=scratch\nE2E_EMAIL=x@y.z\n");
  writeFileSync(join(dir, ".env"), "A=base\nB=base\n");
  const files = readDotenvFiles(dir, [".env.e2e.local", ".env.local", ".env"]);
  assert.deepEqual(files, [{ A: "scratch", E2E_EMAIL: "x@y.z" }, {}, { A: "base", B: "base" }]);
});

// Source-level tripwire: the config may not go back to loading dotenv files or
// building a server env on its own.
for (const config of ["playwright.config.ts", "playwright.launch-readiness.config.ts"]) {
  test(`${config} uses the shared isolation plan and does not inherit dotenv wholesale`, () => {
    const src = readFileSync(join(__dirname, "../..", config), "utf8").replace(/\/\/.*$/gm, "");
    assert.match(src, /planIsolatedServer\(/);
    assert.match(src, /readDotenvFiles\(/);
    assert.doesNotMatch(src, /loadEnvFile/);
    assert.doesNotMatch(src, /\.env\.local['"`]/);
    assert.doesNotMatch(src, /resolveSupabase\(|buildServerEnv\(/);
  });
}

test("the launch-readiness config never reuses a server it did not start", () => {
  const src = readFileSync(join(__dirname, "../..", "playwright.launch-readiness.config.ts"), "utf8");
  assert.match(src.replace(/\/\/.*$/gm, ""), /reuseExistingServer:\s*false/);
});
