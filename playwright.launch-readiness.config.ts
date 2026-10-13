import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { readDotenvFiles } from './tests/e2e/dotenvFiles';
import {
  SHARED_SUPABASE_HATCH,
  dotenvFilesFor,
  mergeDotenv,
  planIsolatedServer,
  scratchDatabaseUrlFromFile,
  testProcessDotenv,
} from './tests/e2e/supabaseIsolation';
import { assertScratchDatabaseUrl } from './tests/launch-readiness/scratchDbGuard';

// The launch-readiness pass writes data and the app cannot delete it, so it
// needs a scratch database AND a Supabase project that is not the shared one.
// Same contract as playwright.config.ts, from the same module
// (tests/e2e/supabaseIsolation.ts), so the rules cannot drift:
//  - DATABASE_URL comes from the shell, or from .env.e2e.local (the only file
//    allowed to supply it), and must be a local `_e2e` database
//    (tests/launch-readiness/scratchDbGuard.ts);
//  - this process loads E2E_* keys from the dotenv files and nothing else;
//  - the app server it starts gets DATABASE_URL and the two Supabase variables
//    and every other dotenv key blanked, instead of inheriting .env.local;
//  - the login must go through a project named for e2e (E2E_SUPABASE_URL +
//    E2E_SUPABASE_ANON_KEY, e.g. the local stack), or E2E_ALLOW_SHARED_SUPABASE=1
//    typed in the shell for that run (never read from a file, warns every run).
const hatch = process.env[SHARED_SUPABASE_HATCH];
const files = readDotenvFiles(__dirname, dotenvFilesFor(true));
Object.assign(process.env, scratchDatabaseUrlFromFile(files[0]!, process.env));
assertScratchDatabaseUrl(process.env.DATABASE_URL);
const databaseUrl = process.env.DATABASE_URL!;
const dotenv = mergeDotenv(files);
Object.assign(process.env, testProcessDotenv(dotenv, process.env));

const isolated = planIsolatedServer({
  label: 'launch-readiness',
  databaseUrl,
  e2eUrl: process.env.E2E_SUPABASE_URL,
  e2eAnonKey: process.env.E2E_SUPABASE_ANON_KEY,
  appUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? dotenv.NEXT_PUBLIC_SUPABASE_URL,
  appAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? dotenv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  hatch,
  serverIsOurs: true,
  dotenvKeys: Object.keys(dotenv),
});
if (isolated.refusal) throw new Error(isolated.refusal);
if (isolated.notice && process.env.TEST_WORKER_INDEX === undefined) console.warn(`\n${isolated.notice}\n`);

// A dedicated port, never reused: a server already listening there was not
// started with the env above and may be pointed at production.
const PORT = 3100;
const STORAGE_STATE = path.join(__dirname, 'tests/.auth/launch-readiness.json');

export default defineConfig({
  testDir: './tests/launch-readiness',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: isolated.serverEnv!,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
});
