"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { parseDropInput } from "@/lib/followUp/cycle";
import { dropFollowUp } from "@/lib/followUp/dropQueries";
import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";
import { isUuid } from "@/lib/uuid";
import { parseExcludedRoleGroups } from "@/lib/followUp/roleGroupPreference";
import { getFollowUpRoleGroupCounts, saveOwnExcludedRoleGroups } from "@/lib/followUp/roleGroupPreferenceDb";
import { postponeFollowUpItem, skipFollowUpItem } from "@/lib/followUp/queueQueries";

/**
 * "Posponer a mañana" / "Omitir hoy" (mockup README decision 5) — neither
 * logs an activity, so unlike the reused quick actions (note/call/email/
 * task/meeting/discard, which navigate into the contact record's own
 * dialogs) these two are the queue's own server actions.
 */
export async function postponeFollowUpAction(itemId: string) {
  const me = await getCurrentBd();
  await postponeFollowUpItem(itemId, me.id, new Date());
  revalidatePath("/follow-ups");
}

export async function skipFollowUpAction(itemId: string) {
  const me = await getCurrentBd();
  await skipFollowUpItem(itemId, me.id, new Date());
  revalidatePath("/follow-ups");
}

export type DropFollowUpResult = { ok: true } | { ok: false; error: "invalid_item" | "reason_required" | "detail_required" | "detail_too_long" };

/**
 * "Dar de baja del seguimiento" (follow-up-expiry). Re-validates on the server what the dialog already enforces (a uuid item id, a known
 * reason, the detail rule, and that the item is Vencido today), then appends the `follow_up_dropped` activity; the pipeline status is untouched. A second click, or an item that was worked or dropped in
 * the meantime, is a quiet no-op (the page refreshes either way).
 */
export async function dropFollowUpAction(itemId: string, reason: string, detail: string): Promise<DropFollowUpResult> {
  const me = await getCurrentBd();
  if (!isUuid(itemId)) return { ok: false, error: "invalid_item" };
  const input = parseDropInput(reason, detail);
  if (!input.ok) return input;
  // `today` makes the server enforce "only a Vencido (day 3-9 in the queue) can be dropped", whatever the client sends.
  await dropFollowUp({ itemId, bdId: me.id, reason: input.reason, detail: input.detail, today: argentinaCalendarDate(new Date()) });
  revalidatePath("/follow-ups");
  return { ok: true };
}

export type SaveRoleGroupsResult = { ok: true } | { ok: false; error: "invalid" | "unknown_group" | "all_excluded" };

/**
 * "Roles a seguir" (follow-up-role-groups). Saves the signed-in BD's OWN deny-list after validating every key against
 * `RoleGroupKey` on the server (an unknown key or an all-excluded list is rejected, whatever the client sent). It changes who
 * ENTERS the next daily build only; nothing already in the queue moves, and no audit_log row is written (a view preference).
 */
export async function saveFollowUpRoleGroupsAction(excluded: string[]): Promise<SaveRoleGroupsResult> {
  const me = await getCurrentBd();
  const parsed = parseExcludedRoleGroups(excluded);
  if (!parsed.ok) return parsed;
  await saveOwnExcludedRoleGroups(me.id, parsed.groups);
  revalidatePath("/follow-ups");
  return { ok: true };
}

/**
 * Per-group due counts for the "Roles a seguir" panel, fetched when the panel is OPENED instead of on every page load: the aggregate
 * measured 73-99 ms against production (a fixed floor from the activity / person_bd_connection scans), for a number read rarely.
 * Always the signed-in BD's own contacts; read-only.
 */
export async function getFollowUpRoleGroupCountsAction(): Promise<Record<string, number>> {
  const me = await getCurrentBd();
  return getFollowUpRoleGroupCounts(me.id);
}
