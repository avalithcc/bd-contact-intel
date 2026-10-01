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
  retries: process.env.CI ? 2 : 0,
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
