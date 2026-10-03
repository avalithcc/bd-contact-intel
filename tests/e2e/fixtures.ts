import { test as base, expect } from '@playwright/test';
import {
  describeViolations,
  isWriteRequest,
  writesAllowed,
  type SeenRequest,
} from './readOnlyGuard';

/**
 * Drop-in replacement for `test` from '@playwright/test'. An auto fixture
 * aborts every write request the app would receive and fails the test if any
 * was attempted, unless DATABASE_URL is a scratch database. Read-only is
 * therefore enforced by the harness, not by reviewer discipline. Server-side
 * writes triggered by a plain GET render (e.g. the admin conversation audit
 * row) are invisible here, so those specs also skip via
 * `skipUnlessWritesAllowed()` in helpers.ts.
 */
export const test = base.extend<{ readOnlyGuard: void }>({
  readOnlyGuard: [
    async ({ context, baseURL }, use) => {
      if (writesAllowed(process.env.DATABASE_URL)) {
        await use();
        return;
      }
      const appOrigin = baseURL ?? 'http://localhost:3000';
      const violations: SeenRequest[] = [];
      await context.route('**/*', async (route) => {
        const { method, url } = { method: route.request().method(), url: route.request().url() };
        if (isWriteRequest({ method, url }, appOrigin)) {
          violations.push({ method, url });
          await route.abort('blockedbyclient');
        } else {
          await route.fallback();
        }
      });
      await use();
      expect(violations, describeViolations(violations)).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
