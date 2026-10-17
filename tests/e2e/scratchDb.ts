/**
 * Direct database access for the e2e specs that need to SEED data (a second BD's Sequences, a scheduled email
 * about to go out, accented names) or to read back what the app wrote. It is only reachable against a local
 * `*_e2e` scratch database: `openScratchDb()` runs the same guard as the writing specs, and every spec that
 * uses it is skipped before this module is called when the run is read-only (skipUnlessWritesAllowed in
 * helpers.ts), so importing it never opens a connection.
 *
 * The caller owns the connection: open it in `beforeAll`, close it in `afterAll`.
 */
import { randomBytes } from 'crypto';
import path from 'path';
import postgres from 'postgres';
import type { Browser } from '@playwright/test';
import { assertScratchDatabaseUrl } from '../launch-readiness/scratchDbGuard';

export type ScratchSql = ReturnType<typeof postgres>;

export function openScratchDb(): ScratchSql {
  assertScratchDatabaseUrl(process.env.DATABASE_URL);
  return postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
}

/** Short unique tag for one run: every row a spec seeds carries it, so cleanup and assertions stay exact. */
export function runTag(): string {
  return randomBytes(3).toString('hex');
}

/** The BD the shared `chromium` session is signed in as (role `bd` in the scratch seed). */
export function e2eBdEmail(): string {
  const email = process.env.E2E_EMAIL?.trim();
  if (!email) throw new Error('E2E_EMAIL is required');
  return email;
}

/** The second, admin login created next to the BD one by scripts/create-e2e-auth-user.ts. */
export function e2eAdminEmail(): string {
  return (process.env.E2E_ADMIN_EMAIL?.trim() || 'admin-e2e@avalith.net').toLowerCase();
}

export const ADMIN_STORAGE_STATE = path.join(__dirname, '../.auth/admin-state.json');

/** Upserts a `bd` row with the given role and name and returns its id. Names must contain "ZZ E2E": contacts-filters.spec.ts skips those when it picks a real BD to filter by. */
export async function ensureBd(sql: ScratchSql, email: string, name: string, role: 'bd' | 'admin'): Promise<string> {
  const [row] = await sql`
    insert into bd (name, email, role, email_reminders_enabled) values (${name}, ${email}, ${role}, false)
    on conflict (email) do update set role = excluded.role, name = excluded.name
    returning id`;
  return row!.id as string;
}

/** A connected mailbox row for the BD (no token: nothing here can reach Gmail). `created` says whether cleanup should remove it. */
export async function ensureEmailAccount(sql: ScratchSql, bdId: string, address: string): Promise<{ id: string; created: boolean }> {
  const [existing] = await sql`select id, status from email_account where bd_id = ${bdId}`;
  if (existing) {
    if (existing.status !== 'connected') await sql`update email_account set status = 'connected' where bd_id = ${bdId}`;
    return { id: existing.id as string, created: false };
  }
  const [row] = await sql`insert into email_account (bd_id, email_address, status) values (${bdId}, ${address}, 'connected') returning id`;
  return { id: row!.id as string, created: true };
}

/**
 * Signs in through the real login form (the same steps as auth.setup.ts) in a throwaway context and saves its
 * session, so a describe can run as another account with `test.use({ storageState })`.
 */
export async function saveLoginState(browser: Browser, baseURL: string, email: string, file: string): Promise<void> {
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error('E2E_PASSWORD is required to log in as the admin account');
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.locator('form:has(#email) button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
    await context.storageState({ path: file });
  } finally {
    await context.close();
  }
}
