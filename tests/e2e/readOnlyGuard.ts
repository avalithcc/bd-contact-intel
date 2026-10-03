/**
 * The general e2e suite runs against whatever DATABASE_URL points at, which on
 * a developer machine is production, and the app has no delete path: a write
 * is permanent. So the suite is read-only BY CONSTRUCTION, and the only thing
 * that unlocks writes is a scratch database (the same `assertScratchDatabaseUrl`
 * rule the launch-readiness pass enforces). Anything else, including a missing
 * or unparsable DATABASE_URL, is treated as production (fail closed).
 *
 * Pure, with no Playwright imports, so it is unit-testable
 * (tests/unit/e2eReadOnlyGuard.test.ts). tests/e2e/fixtures.ts wires it in.
 */
import { assertScratchDatabaseUrl } from '../launch-readiness/scratchDbGuard';

export interface SeenRequest {
  method: string;
  url: string;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// GET route handlers that nonetheless mutate or start side effects (cron
// syncs, lead ingest, OAuth start/callback) plus the OTP confirm, which
// creates a session. No read-only spec has a reason to hit them.
const SIDE_EFFECT_GET_PREFIXES = ['/api/', '/auth/confirm'];

// Dev-server plumbing, never application writes.
const IGNORED_PREFIXES = ['/_next/', '/__nextjs'];

/**
 * True when `request` reaches the app (same origin as `appOrigin`) and could
 * write: any non-safe method (a server action is a POST to a page URL), or a
 * GET to a side-effecting route. Other origins (Supabase auth, fonts) are not
 * the app's writes and are ignored.
 */
export function isWriteRequest(request: SeenRequest, appOrigin: string): boolean {
  let url: URL;
  let origin: string;
  try {
    url = new URL(request.url);
    origin = new URL(appOrigin).origin;
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (IGNORED_PREFIXES.some((p) => url.pathname.startsWith(p))) return false;
  if (!SAFE_METHODS.has(request.method.toUpperCase())) return true;
  return SIDE_EFFECT_GET_PREFIXES.some((p) => url.pathname.startsWith(p));
}

/** Writes are allowed only against a local `*_e2e` scratch database. */
export function writesAllowed(databaseUrl: string | undefined): boolean {
  try {
    assertScratchDatabaseUrl(databaseUrl);
    return true;
  } catch {
    return false;
  }
}

/** Null when writes are allowed, otherwise the reason a writing test must skip. */
export function writeSkipReason(databaseUrl: string | undefined): string | null {
  if (writesAllowed(databaseUrl)) return null;
  return (
    'This test writes data. The e2e suite is read-only unless DATABASE_URL is a local scratch ' +
    'database whose name ends in _e2e (anything else is treated as production).'
  );
}

export interface ServerPlan {
  port: number;
  reuseExistingServer: boolean;
  /** Explicit env for the dev server; set only when writes are allowed. */
  env?: { DATABASE_URL: string };
}

/**
 * Which app server the suite talks to. The guard above judges the TEST
 * process's DATABASE_URL, but writes land wherever the SERVER points. A dev
 * server already listening on :3000 loads .env.local (production), so once
 * writes are allowed the suite must start its OWN server on a dedicated port
 * with DATABASE_URL passed explicitly, and never reuse one (same reasoning as
 * playwright.launch-readiness.config.ts). In read-only mode reuse is safe:
 * the request guard blocks writes whichever database that server uses.
 */
export function serverPlan(databaseUrl: string | undefined, ci: boolean): ServerPlan {
  if (writesAllowed(databaseUrl)) {
    return { port: 3101, reuseExistingServer: false, env: { DATABASE_URL: databaseUrl! } };
  }
  return { port: 3000, reuseExistingServer: !ci };
}

export function describeViolations(violations: SeenRequest[]): string {
  return [
    'The e2e suite is read-only against this database, but the page sent write requests (blocked, nothing reached the app):',
    ...violations.map((v) => `  ${v.method.toUpperCase()} ${v.url}`),
    'If a spec genuinely needs to write, run it against a scratch database (tests/e2e/README.md).',
  ].join('\n');
}
