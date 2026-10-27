/**
 * The three `activity.type` values follow-up-expiry writes. Deliberately dependency-free so the lists that must know about
 * them (NO_PROGRESS_ACTIVITY_TYPES, NON_TOUCH_ACTIVITY_TYPES, STATUS_NEUTRAL_ACTIVITY_TYPES) can import it without a cycle.
 *
 * They record what happened to the contact's place in Seguimientos, never a conversation with the contact, so all three are
 * in each of those lists: a drop must not restart the cadence (it would re-queue the contact five days after being dropped),
 * must not show as "Ultima actividad", must not move the pipeline stage and must not transfer ownership.
 *
 *  - dropped:   a BD took the contact out of Seguimientos ("Dar de baja del seguimiento"). Actor = that BD.
 *  - expired:   the system dropped it after 10 days in the queue without action. No actor.
 *  - reentered: the contact came back after a drop because of new activity. No actor.
 */
export const FOLLOW_UP_DROPPED_TYPE = "follow_up_dropped";
export const FOLLOW_UP_EXPIRED_TYPE = "follow_up_expired";
export const FOLLOW_UP_REENTERED_TYPE = "follow_up_reentered";

export const FOLLOW_UP_ACTIVITY_TYPES = [FOLLOW_UP_DROPPED_TYPE, FOLLOW_UP_EXPIRED_TYPE, FOLLOW_UP_REENTERED_TYPE] as const;

/** The two types that take a contact out of the queue until new activity restarts the cadence. */
export const FOLLOW_UP_DROP_ACTIVITY_TYPES = [FOLLOW_UP_DROPPED_TYPE, FOLLOW_UP_EXPIRED_TYPE] as const;
