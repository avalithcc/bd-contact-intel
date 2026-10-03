import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { assertScratchDatabaseUrl } from './scratchDbGuard';

// Every spec imports this file, so the guard runs before any query is made.
assertScratchDatabaseUrl(process.env.DATABASE_URL);

export const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });

export const E2E_EMAIL = process.env.E2E_EMAIL!;

export async function meId(): Promise<string> {
  const [row] = await sql`select id from bd where email = ${E2E_EMAIL}`;
  return row!.id as string;
}

export async function otherBdId(): Promise<string> {
  const [row] = await sql`select id from bd where email = 'otro-bd-e2e@avalith.net'`;
  return row!.id as string;
}

let counter = 0;
/** A fresh synthetic contact owned by the e2e BD, so a spec never depends on another spec's leftovers. */
export async function newPerson(
  label: string,
  opts: { status?: string; phone?: string | null; ownerId?: string; companyKey?: string; companyName?: string } = {},
): Promise<{ id: string; name: string }> {
  counter += 1;
  const first = `Zz${label}${Date.now().toString(36)}${counter}`;
  const last = 'Pasada';
  const owner = opts.ownerId ?? (await meId());
  const [row] = await sql`
    insert into person (first_name, last_name, email, email_normalized, phone, company, company_key, job_title, owner_bd_id, status)
    values (${first}, ${last}, ${`${first}@example.com`.toLowerCase()}, ${`${first}@example.com`.toLowerCase()},
            ${opts.phone === undefined ? '+1 555 010 0199' : opts.phone}, ${opts.companyName ?? 'Acme Pruebas'},
            ${opts.companyKey ?? 'acme-pruebas'}, 'CTO', ${owner}, ${opts.status ?? 'new'})
    returning id`;
  return { id: row!.id as string, name: `${first} ${last}` };
}

export async function activitiesFor(personId: string) {
  return sql<
    { id: string; type: string; actor_bd_id: string | null; metadata: Record<string, unknown>; created_at: Date }[]
  >`select id, type, actor_bd_id, metadata, created_at from activity where person_id = ${personId} order by created_at, id`;
}

export async function tasksFor(personId: string) {
  return sql<
    {
      id: string;
      title: string;
      status: string;
      description: string | null;
      due_at: Date | null;
      actor_bd_id: string | null;
      assigned_to_bd_id: string | null;
    }[]
  >`select id, title, status, description, due_at, actor_bd_id, assigned_to_bd_id from task where person_id = ${personId} order by created_at`;
}

export async function personStatus(personId: string): Promise<string> {
  const [row] = await sql`select status from person where id = ${personId}`;
  return row!.status as string;
}

/** Opens a record the way a BD does after the list: by URL here, by link where a spec exercises navigation. */
export async function openContact(page: Page, id: string) {
  await page.goto(`/contacts/${id}`);
  await page.waitForLoadState('networkidle');
  await expect(page).not.toHaveURL(/\/login/);
}

export const QUICK = { call: 'Llamada', task: 'Tarea', meeting: 'Reunión', discard: 'Descartar' } as const;

/** Quick-action buttons live in the `.quick-actions` toolbar (Nota is an anchor, the rest are buttons). */
export async function openQuickAction(page: Page, action: keyof typeof QUICK) {
  await page.locator('.quick-actions').getByRole('button', { name: QUICK[action], exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return page.getByRole('dialog');
}

/** Argentina (UTC-3, no DST) calendar date `daysFromNow` days away, as YYYY-MM-DD. */
export function argDate(daysFromNow = 0): string {
  const shifted = new Date(Date.now() - 3 * 3600_000 + daysFromNow * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}
