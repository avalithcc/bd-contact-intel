/**
 * Cross-route freshness. A server action that changes a Contact revalidates its record path itself; the LISTS that show
 * the same data (last contact, status, queue, scheduled, tasks) are listed here once, so an action only names the effect
 * it has instead of repeating paths. Exact paths only (no layout-wide revalidation).
 */
import { revalidatePath } from "next/cache";

export type ListEffect = "touch" | "contactList" | "scheduled" | "tasks" | "meetings" | "sequences";

const PATHS: Record<ListEffect, readonly string[]> = {
  // Email sent/replied, call/meeting/status/owner change: moves the follow-up queue, scheduled list and contact columns.
  touch: ["/follow-ups", "/scheduled", "/contacts"],
  contactList: ["/contacts"],
  scheduled: ["/scheduled"],
  tasks: ["/tasks"],
  meetings: ["/reuniones"],
  sequences: ["/sequences"],
};

/** Pure: the de-duplicated list paths for these effects, in first-seen order. Never mutates its input. */
export function listPathsFor(effects: readonly ListEffect[]): string[] {
  return [...new Set(effects.flatMap((e) => PATHS[e]))];
}

export function revalidateLists(...effects: ListEffect[]): void {
  for (const path of listPathsFor(effects)) revalidatePath(path);
}
