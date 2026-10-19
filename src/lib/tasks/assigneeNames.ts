/**
 * One read for the assignee names a batch of `task_created` activities shows.
 * Takes the caller's transaction so it adds one round trip, never one per task.
 */
import { inArray } from "drizzle-orm";
import type { db } from "@/db";
import { bd } from "@/db/schema";

export async function loadBdNames(
  exec: Pick<typeof db, "select">,
  ids: readonly (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => i !== null))];
  if (!unique.length) return new Map();
  const rows = await exec.select({ id: bd.id, name: bd.name }).from(bd).where(inArray(bd.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}
