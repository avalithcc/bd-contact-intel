/**
 * Finds the live person for a normalized LinkedIn `profile_key`. `profile_key`
 * is unique across ALL person rows, merged-away ones included (they keep their
 * key forever, see src/lib/identity/mergedProfileKeys.ts), so one indexed
 * equality lookup finds the holder and, when it was merged, the merge chain is
 * followed to the survivor. Returns only an id: the record page decides what
 * the viewer may see, exactly as for any other contact link.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { person } from "@/db/schema";

const MAX_MERGE_HOPS = 10;

/** `database` exists for tests/db (a rolled-back transaction); production passes nothing. */
export async function findLivePersonIdByProfileKey(
  profileKey: string,
  database: Pick<typeof db, "select"> = db,
): Promise<string | null> {
  const [holder] = await database
    .select({ id: person.id, mergedIntoId: person.mergedIntoId })
    .from(person)
    .where(eq(person.profileKey, profileKey))
    .limit(1);
  let current = holder;
  for (let hop = 0; current?.mergedIntoId && hop < MAX_MERGE_HOPS; hop++) {
    const [next] = await database
      .select({ id: person.id, mergedIntoId: person.mergedIntoId })
      .from(person)
      .where(eq(person.id, current.mergedIntoId))
      .limit(1);
    current = next;
  }
  return current && !current.mergedIntoId ? current.id : null;
}
