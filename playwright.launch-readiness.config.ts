import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { assertScratchDatabaseUrl } from './tests/launch-readiness/scratchDbGuard';

// The launch-readiness pass writes data and the app cannot delete it, so this
// config NEVER reads .env.local (which points at production). It reads only
// .env.e2e.local, and refuses to start unless DATABASE_URL is a local `_e2e`
// database (see tests/launch-readiness/scratchDbGuard.ts).
const envFile = path.join(__dirname, '.env.e2e.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
assertScratchDatabaseUrl(process.env.DATABASE_URL);

// A dedicated port, never reused: a dev server already listening on :3000 may
// be pointed at production.
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
    reuseExistingServer: true,
    timeout: 180_000,
    env: { DATABASE_URL: process.env.DATABASE_URL! },
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
