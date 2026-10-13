import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOTENV_FILES_BY_PRECEDENCE,
  SERVER_ENV_ALLOWLIST,
  SHARED_SUPABASE_HATCH,
  buildServerEnv,
  dotenvFilesFor,
  isLocalSupabaseUrl,
  mergeDotenv,
  resolveSupabase,
  testProcessDotenv,
} from "../e2e/supabaseIsolation";

const APP = "https://appproject.example.test";
const APP_KEY = "app-anon";
const E2E = "https://throwaway.example.test";
const E2E_KEY = "e2e-anon";

const shared = { appUrl: APP, appAnonKey: APP_KEY, serverIsOurs: true };

test("with nothing named for e2e, the app's own project is shared and refused without the hatch", () => {
  const r = resolveSupabase(shared);
  assert.equal(r.target, null);
  assert.match(r.refusal ?? "", /SHARED Supabase/);
  assert.match(r.refusal ?? "", new RegExp(SHARED_SUPABASE_HATCH));
  assert.match(r.refusal ?? "", /E2E_SUPABASE_URL/);
});

test("the refusal never prints a URL or a key", () => {
  for (const input of [shared, { ...shared, e2eUrl: APP, e2eAnonKey: E2E_KEY }]) {
    const msg = resolveSupabase(input).refusal ?? "";
    assert.ok(!msg.includes(APP) && !msg.includes(APP_KEY) && !msg.includes(E2E_KEY));
  }
});

test("only the exact value 1 opens the hatch", () => {
  for (const hatch of [undefined, "", "0", "true", "yes", "11"]) {
    assert.ok(resolveSupabase({ ...shared, hatch }).refusal, String(hatch));
  }
  assert.equal(resolveSupabase({ ...shared, hatch: " 1 " }).refusal, null);
});

test("the hatch uses the app's project and says so loudly", () => {
  const r = resolveSupabase({ ...shared, hatch: "1" });
  assert.deepEqual(r.target, { url: APP, anonKey: APP_KEY, shared: true });
  assert.match(r.notice ?? "", /SHARED Supabase project/);
});

test("a distinct E2E_SUPABASE_URL is a dedicated project: no hatch, no notice", () => {
  const r = resolveSupabase({ ...shared, e2eUrl: E2E, e2eAnonKey: E2E_KEY });
  assert.deepEqual(r.target, { url: E2E, anonKey: E2E_KEY, shared: false });
  assert.equal(r.refusal, null);
  assert.equal(r.notice, null);
});

test("E2E_SUPABASE_URL equal to the app's project is still shared (a copied production value)", () => {
  const input = { ...shared, e2eUrl: `${APP.toUpperCase()}/`, e2eAnonKey: E2E_KEY };
  assert.ok(resolveSupabase(input).refusal);
  const ok = resolveSupabase({ ...input, hatch: "1" });
  assert.equal(ok.target?.shared, true);
  assert.equal(ok.target?.anonKey, E2E_KEY);
});

test("E2E_SUPABASE_URL without its anon key is refused, hatch or not", () => {
  const r = resolveSupabase({ ...shared, e2eUrl: E2E, hatch: "1" });
  assert.match(r.refusal ?? "", /E2E_SUPABASE_ANON_KEY/);
});

test("a dedicated project cannot be promised to a server the suite did not start", () => {
  const r = resolveSupabase({ ...shared, e2eUrl: E2E, e2eAnonKey: E2E_KEY, serverIsOurs: false });
  assert.match(r.refusal ?? "", /server the suite starts itself/);
});

test("nothing configured at all fails closed, even with the hatch", () => {
  assert.ok(resolveSupabase({ serverIsOurs: true, hatch: "1" }).refusal);
  assert.ok(resolveSupabase({ serverIsOurs: true, hatch: "1", appUrl: APP }).refusal);
});

test("resolveSupabase does not mutate its input and is repeatable", () => {
  const input = { ...shared, e2eUrl: E2E, e2eAnonKey: E2E_KEY, hatch: "1" };
  const copy = structuredClone(input);
  assert.deepEqual(resolveSupabase(input), resolveSupabase(input));
  assert.deepEqual(input, copy);
});

test("the server env allowlists three variables and blanks every other dotenv key", () => {
  const env = buildServerEnv({
    databaseUrl: "postgres://localhost/x_e2e",
    supabase: { url: E2E, anonKey: E2E_KEY },
    dotenvKeys: ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "GMAIL_TOKEN_ENCRYPTION_KEY", "SMTP_PASSWORD"],
  });
  assert.equal(env.DATABASE_URL, "postgres://localhost/x_e2e");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, E2E);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, E2E_KEY);
  assert.equal(env.GMAIL_TOKEN_ENCRYPTION_KEY, "");
  assert.equal(env.SMTP_PASSWORD, "");
  assert.deepEqual(
    Object.keys(env).filter((k) => env[k] !== "").sort(),
    [...SERVER_ENV_ALLOWLIST].sort(),
  );
});

test("buildServerEnv does not mutate its input and is repeatable", () => {
  const input = {
    databaseUrl: "postgres://localhost/x_e2e",
    supabase: { url: E2E, anonKey: E2E_KEY },
    dotenvKeys: ["A_SECRET"],
  };
  const copy = structuredClone(input);
  assert.deepEqual(buildServerEnv(input), buildServerEnv(input));
  assert.deepEqual(input, copy);
});

test("mergeDotenv: the first file in precedence order wins per key, inputs untouched", () => {
  const local = { A: "local", B: "local" };
  const base = { A: "base", C: "base" };
  const merged = mergeDotenv([local, base]);
  assert.deepEqual(merged, { A: "local", B: "local", C: "base" });
  assert.deepEqual(local, { A: "local", B: "local" });
  assert.deepEqual(base, { A: "base", C: "base" });
});

test("the test process takes E2E_* from dotenv, never the hatch, never an app secret, never over the shell", () => {
  const out = testProcessDotenv(
    {
      E2E_EMAIL: "a@b.c",
      E2E_PASSWORD: "pw",
      E2E_SUPABASE_URL: E2E,
      E2E_PASSWORD_EXTRA: "x",
      [SHARED_SUPABASE_HATCH]: "1",
      DATABASE_URL: "postgres://prod",
      GOOGLE_OAUTH_CLIENT_SECRET: "s",
    },
    { E2E_EMAIL: "from-shell@b.c" },
  );
  assert.deepEqual(out, { E2E_PASSWORD: "pw", E2E_SUPABASE_URL: E2E, E2E_PASSWORD_EXTRA: "x" });
});

test("the e2e dotenv file is read first in a scratch run and never otherwise", () => {
  const scratch = dotenvFilesFor(true);
  assert.equal(scratch[0], ".env.e2e.local");
  assert.deepEqual(scratch.slice(1), [...DOTENV_FILES_BY_PRECEDENCE]);
  assert.deepEqual(dotenvFilesFor(false), [...DOTENV_FILES_BY_PRECEDENCE]);
});

test("dotenvFilesFor returns a fresh array and leaves the shared list alone", () => {
  const before = [...DOTENV_FILES_BY_PRECEDENCE];
  const a = dotenvFilesFor(true);
  a.push("mutated");
  assert.deepEqual(dotenvFilesFor(true).slice(1), before);
  assert.deepEqual([...DOTENV_FILES_BY_PRECEDENCE], before);
});

test("isLocalSupabaseUrl accepts only loopback hosts", () => {
  for (const ok of ["http://127.0.0.1:54321", "http://localhost:54321/", "http://[::1]:54321"]) {
    assert.equal(isLocalSupabaseUrl(ok), true, ok);
  }
  for (const bad of [
    "https://abcdefgh.supabase.co",
    "http://127.0.0.1.evil.example",
    "http://localhost.evil.example",
    "http://10.0.0.5:54321",
    "not a url",
    "",
    undefined,
  ]) {
    assert.equal(isLocalSupabaseUrl(bad), false, String(bad));
  }
});
