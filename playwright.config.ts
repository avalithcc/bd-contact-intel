import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { skipReason } from './tests/e2e/credentials';

// Playwright does not read .env.local on its own (only `next dev` does), so
// load it here for E2E_EMAIL / E2E_PASSWORD. Existing variables win.
const envLocal = path.join(__dirname, '.env.local');
if (fs.existsSync(envLocal)) process.loadEnvFile(envLocal);

const STORAGE_STATE = path.join(__dirname, 'tests/.auth/state.json');

// The list reporter hides skip reasons, so say it once (the main process only,
// not every worker) where a developer will see it.
if (skipReason() && process.env.TEST_WORKER_INDEX === undefined) {
  console.warn(`\n[e2e] ${skipReason()}\n`);
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
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  // Nothing can run without credentials outside CI (every test is skipped), so
  // do not boot a dev server just to skip. In CI skipReason() is null.
  webServer: skipReason()
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
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
