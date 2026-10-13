import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { parseEnv } from 'util';
import { isCi, skipReason } from './tests/e2e/credentials';
import { serverPlan } from './tests/e2e/readOnlyGuard';
import {
  SHARED_SUPABASE_HATCH,
  buildServerEnv,
  dotenvFilesFor,
  mergeDotenv,
  resolveSupabase,
  testProcessDotenv,
} from './tests/e2e/supabaseIsolation';

// Playwright does not read dotenv files on its own (only `next dev` does).
// This process loads E2E_* settings from them and NOTHING else: no production
// DATABASE_URL, no OAuth or Gmail secret. Existing variables win. The shared
// Supabase hatch is read from the shell BEFORE any file is consulted and is
// never loaded from a file. See tests/e2e/supabaseIsolation.ts.
const hatch = process.env[SHARED_SUPABASE_HATCH];
// DATABASE_URL is never loaded from a file (only E2E_* is), so the shell value
// decides whether this is a scratch run before any dotenv file is read.
const scratchRun = serverPlan(process.env.DATABASE_URL, isCi()).env !== undefined;
const dotenvFiles = dotenvFilesFor(scratchRun).map((name) => {
  const file = path.join(__dirname, name);
  return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
});
const dotenv = mergeDotenv(dotenvFiles);
Object.assign(process.env, testProcessDotenv(dotenv, process.env));

const STORAGE_STATE = path.join(__dirname, 'tests/.auth/state.json');

// Read-only mode (the default, and always against production): reuse a dev
// server on :3000 is fine because tests/e2e/fixtures.ts blocks writes no matter
// which database that server uses. Scratch mode (DATABASE_URL is a local _e2e
// database): the suite may write, and writes land wherever the SERVER points,
// not where this process's DATABASE_URL points. A dev server on :3000 loads
// .env.local (production), so scratch mode starts its own server on a
// dedicated port with an explicit env and never reuses one.
// See serverPlan() in tests/e2e/readOnlyGuard.ts.
const plan = serverPlan(process.env.DATABASE_URL, isCi());
const BASE_URL = `http://localhost:${plan.port}`;

// The list reporter hides skip reasons, so say it once (the main process only,
// not every worker) where a developer will see it.
if (skipReason() && process.env.TEST_WORKER_INDEX === undefined) {
  console.warn(`\n[e2e] ${skipReason()}\n`);
}

// Which Supabase project the login goes through, and exactly what the app
// server receives. With no credentials nothing logs in, so nothing to judge.
// A refusal throws at config load: the run fails before any server boots.
let serverEnv: Record<string, string> | undefined;
if (!skipReason()) {
  const supabase = resolveSupabase({
    e2eUrl: process.env.E2E_SUPABASE_URL,
    e2eAnonKey: process.env.E2E_SUPABASE_ANON_KEY,
    appUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? dotenv.NEXT_PUBLIC_SUPABASE_URL,
    appAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? dotenv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hatch,
    serverIsOurs: plan.env !== undefined,
  });
  if (supabase.refusal) throw new Error(`[e2e] ${supabase.refusal}`);
  if (supabase.notice && process.env.TEST_WORKER_INDEX === undefined) {
    console.warn(`\n[e2e] WARNING ${supabase.notice}\n`);
  }
  if (plan.env && supabase.target) {
    serverEnv = buildServerEnv({
      databaseUrl: plan.env.DATABASE_URL,
      supabase: supabase.target,
      dotenvKeys: Object.keys(dotenv),
    });
  }
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Local runs get ONE retry, not zero. `npm run dev` compiles each route on
  // its first visit, so the first navigation to a route can outlast the
  // spec's own navigation budget and fail a test that is perfectly healthy.
  // Observed 2026-10-01: three consecutive runs of phase1.spec.ts, a
  // DIFFERENT test failing each time, every failure a navigation timeout
  // (one passing test measured 12.9s against a 15s budget), and all 11 green
  // once the server was warm. That noise is worse than useless — it nearly
  // got a non-existent regression reported against a just-merged PR. A
  // single retry absorbs the cold compile without hiding anything: a real
  // failure is deterministic and still fails both attempts.
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  // Nothing can run without credentials outside CI (every test is skipped), so
  // do not boot a dev server just to skip. In CI skipReason() is null.
  webServer: skipReason()
    ? undefined
    : {
        command: `npx next dev -p ${plan.port}`,
        url: BASE_URL,
        reuseExistingServer: plan.reuseExistingServer,
        timeout: 120_000,
        ...(serverEnv ? { env: serverEnv } : {}),
      },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
});
