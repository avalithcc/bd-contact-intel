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

export async function listContacts(
  bdId: string,
  filters: ContactFilters = {},
): Promise<ContactRow[]> {
  const where = [eq(contact.bdId, bdId)];
  if (filters.company) where.push(ilike(contact.company, `%${filters.company}%`));
  if (filters.position)
    where.push(ilike(contact.position, `%${filters.position}%`));

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
    .limit(500);

  const keys = rows.map((r) => r.profileKey);
  const overlap = new Map<string, string[]>();
  if (keys.length) {
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
  }

  return rows.map((r) => ({
    ...r,
    overlapWith: overlap.get(r.profileKey) ?? [],
  }));
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
