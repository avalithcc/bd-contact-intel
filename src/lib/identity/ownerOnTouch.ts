/**
 * Pure planner for "the BD who contacts becomes the owner", run when a touch
 * lands (DB glue: ownerOnTouchDb.ts). It adds NO rule: it is planOwnerBackfill
 * (decideOwner + sticky manual owners) restricted to the `last_touch` basis.
 *
 * Why the restriction: the `earliest_connection` fallback means "nobody has
 * touched the contact", so it can only fire when the triggering write was not a
 * touch (e.g. an auto-reply). A non-touch must not move an owner; the nightly
 * cron still owns that fallback. Never mutates its input.
 */
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { NON_TOUCH_ACTIVITY_TYPES } from "@/lib/contacts/effectiveActivityTime";
import { planOwnerBackfill, type OwnerBackfillInput, type OwnerChange } from "@/lib/identity/ownerBackfillPlan";

export type OwnerOnTouchInput = OwnerBackfillInput;

export function planOwnerTransfersOnTouch(input: OwnerOnTouchInput): OwnerChange[] {
  return planOwnerBackfill(input).changes.filter((c) => c.basis === "last_touch");
}

/**
 * Cheap pre-filter for call sites that know the activity type: skip the owner reads for writes that can never be a
 * touch. It only saves round trips; readOwnerTouches applies the same two lists in SQL, which stays the authority.
 */
export function isOwnerTouchType(type: string): boolean {
  return !(NO_PROGRESS_ACTIVITY_TYPES as readonly string[]).includes(type) && !(NON_TOUCH_ACTIVITY_TYPES as readonly string[]).includes(type);
}
