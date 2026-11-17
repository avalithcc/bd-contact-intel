/**
 * Server-only: reads the CONTACT OWNER's follow-up facts. Split out of returnDate.ts because that module is imported
 * by a client component, and a db import there put node:fs in the client bundle.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bd } from "@/db/schema";

/**
 * The owner facts `followUpReturn` needs. The signed-in BD is reused when the contact is theirs, so the common case
 * costs no query; any other owner is one indexed lookup by primary key.
 */
export async function followUpOwnerOf(
  ownerBdId: string | null,
  me: { id: string; name: string | null; followUpExcludedRoleGroups: readonly string[] },
): Promise<{ bdId: string | null; name: string | null; excludedRoleGroups: readonly string[] }> {
  if (ownerBdId === null) return { bdId: null, name: null, excludedRoleGroups: [] };
  if (ownerBdId === me.id) return { bdId: me.id, name: me.name, excludedRoleGroups: me.followUpExcludedRoleGroups };
  const [row] = await db
    .select({ name: bd.name, excluded: bd.followUpExcludedRoleGroups })
    .from(bd)
    .where(eq(bd.id, ownerBdId));
  return { bdId: ownerBdId, name: row?.name ?? null, excludedRoleGroups: row?.excluded ?? [] };
}
