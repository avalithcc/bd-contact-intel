import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, contact, type NewContact } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolves the current BD from the authenticated Supabase user, creating the
 * `bd` row on first sign-in. Callers run behind middleware that redirects
 * unauthenticated requests to /login, so a missing user is an error here.
 */
export async function getCurrentBd() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Not authenticated");

  const existing = await db.query.bd.findFirst({
    where: eq(bd.email, user.email),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(bd)
    .values({ name: user.email.split("@")[0], email: user.email })
    .returning();
  return created;
}

export interface ContactFilters {
  company?: string;
  position?: string;
}

export interface ContactRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  profileKey: string;
  overlapWith: string[]; // names of other BDs who also hold this contact
}

export interface ContactsPage {
  rows: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Resolve the names of other BDs who also hold each of the given profile keys. */
async function overlapByProfileKey(
  bdId: string,
  keys: string[],
): Promise<Map<string, string[]>> {
  const overlap = new Map<string, string[]>();
  if (!keys.length) return overlap;
  const others = await db
    .select({ profileKey: contact.profileKey, name: bd.name })
    .from(contact)
    .innerJoin(bd, eq(contact.bdId, bd.id))
    .where(
      and(inArray(contact.profileKey, keys), sql`${contact.bdId} <> ${bdId}`),
    );
  for (const o of others) {
    const list = overlap.get(o.profileKey) ?? [];
    list.push(o.name);
    overlap.set(o.profileKey, list);
  }
  return overlap;
}

export async function listContacts(
  bdId: string,
  filters: ContactFilters = {},
  page = 1,
  pageSize = 20,
): Promise<ContactsPage> {
  const where = [eq(contact.bdId, bdId)];
  if (filters.company) where.push(ilike(contact.company, `%${filters.company}%`));
  if (filters.position)
    where.push(ilike(contact.position, `%${filters.position}%`));

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contact)
    .where(and(...where));

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const rows = await db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      position: contact.position,
      profileKey: contact.profileKey,
    })
    .from(contact)
    .where(and(...where))
    .orderBy(contact.lastName)
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const overlap = await overlapByProfileKey(
    bdId,
    rows.map((r) => r.profileKey),
  );

  return {
    rows: rows.map((r) => ({ ...r, overlapWith: overlap.get(r.profileKey) ?? [] })),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export interface ContactDetail {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  email: string | null;
  industry: string | null;
  connectedOn: string | null;
  profileKey: string;
  createdAt: Date;
  overlapWith: string[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Full detail for one contact, scoped to the owning BD. Null if not found/owned. */
export async function getContactById(
  bdId: string,
  id: string,
): Promise<ContactDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db
    .select()
    .from(contact)
    .where(and(eq(contact.bdId, bdId), eq(contact.id, id)))
    .limit(1);
  if (!row) return null;

  const overlap = await overlapByProfileKey(bdId, [row.profileKey]);
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    position: row.position,
    email: row.email,
    industry: row.industry,
    connectedOn: row.connectedOn,
    profileKey: row.profileKey,
    createdAt: row.createdAt,
    overlapWith: overlap.get(row.profileKey) ?? [],
  };
}

/** Upsert a batch of parsed connections into a BD's private base. */
export async function upsertContacts(
  bdId: string,
  rows: Omit<NewContact, "bdId">[],
): Promise<number> {
  if (!rows.length) return 0;
  let count = 0;
  // chunk to keep parameter counts sane
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({ ...r, bdId }));
    await db
      .insert(contact)
      .values(chunk)
      .onConflictDoUpdate({
        target: [contact.bdId, contact.profileKey],
        set: {
          firstName: sql`excluded.first_name`,
          lastName: sql`excluded.last_name`,
          company: sql`excluded.company`,
          position: sql`excluded.position`,
          email: sql`excluded.email`,
          connectedOn: sql`excluded.connected_on`,
        },
      });
    count += chunk.length;
  }
  return count;
}
