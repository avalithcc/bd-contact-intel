import { test as base, expect } from '@playwright/test';
import { withReadOnlyMarker } from '../../src/lib/auth/bdProvisioning';
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
 * writes triggered by a plain GET render are invisible to a request guard, so
 * the one known case (the first-visit `bd` insert in getCurrentBd) is closed
 * by marking every allowed request with a header the server honors outside
 * production (src/lib/auth/bdProvisioning.ts). Writing specs also skip via
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
          // Mark what gets through to the APP so the server can refuse the one
          // write this request-level guard cannot see: getCurrentBd's
          // first-visit `bd` insert (src/lib/auth/bdProvisioning.ts; ignored
          // in production). Other origins (Supabase, fonts) get no extra
          // header: a custom one would force a CORS preflight on them.
          const toApp = new URL(url).origin === new URL(appOrigin).origin;
          await route.fallback(toApp ? { headers: withReadOnlyMarker(route.request().headers()) } : {});
        }
      });
      await use();
      expect(violations, describeViolations(violations)).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
