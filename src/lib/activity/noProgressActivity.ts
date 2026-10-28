import { FOLLOW_UP_ACTIVITY_TYPES } from "@/lib/followUp/activityTypes";

/**
 * Activity types that mean "the BD tried and nothing happened": real engagement
 * (they still count as "última actividad") that must NOT count as progress.
 *
 * ONE list, two consumers, deliberately:
 *  - the owner rule (identity/ownerRuleDb.ts#readOwnerTouches): dialling a
 *    number is not working the relationship, so it never transfers a contact
 *    away from the BD who built it. Ownership is stricter than "última
 *    actividad", which is why this is NOT NON_TOUCH_ACTIVITY_TYPES;
 *  - the follow-up clock (followUp/candidateQuery.ts#fuq_activity): an
 *    unanswered dial must not buy a week of silence.
 * `lusha_reveal` rides the same list (D15): buying an email is work on the Contact but not
 * progress, so it must not transfer ownership or reset the clock. It is deliberately NOT in
 * NON_TOUCH_ACTIVITY_TYPES, so it still counts as "ultima actividad".
 * `auto_reply_received` (an inbound out-of-office) rides it too: it is the machine answering, not us
 * touching the Contact. If it reset the clock, every auto-reply would push the follow-up another 7
 * days away, and a robot would decide when we come back. It must not transfer ownership either.
 * It still counts as "ultima actividad" (not a non-touch): it is real, visible mail.
 * Adding a type here changes BOTH at once. If they ever need to differ, split
 * the list then, on purpose, not by editing one consumer's copy.
 *
 * Why the follow-up clock excludes it (owner decision): leaving attempts in
 * loses contacts silently, since one unanswered dial resets the staleness
 * window (7 days for `contacted`, 3 for `replied`) and nobody notices. Leaving
 * them out means unreachable contacts come back daily and could clog the
 * 10-slot cap. The queue held 6 contacts against that cap when this was
 * decided, so the clog was theoretical and the silent loss concrete. If the
 * queue fills with people who never answer, build a real retry cadence (back
 * in 2 days, not 7 or never); that needs attempt data, which did not exist yet.
 */
export const NO_PROGRESS_ACTIVITY_TYPES = [
  "call_attempt",
  // "No tiene WhatsApp" reached no one: it must not transfer the contact, close a cycle or reset the clock (whatsapp-como-actividad).
  "whatsapp_no_channel",
  "lusha_reveal",
  "auto_reply_received",
  "email_bounced",
  // follow-up-expiry: a drop (by a BD or by the expiry job) or a re-entry records what happened to the contact's place in
  // Seguimientos. If it counted as a touch the contact would be re-queued five days after being dropped.
  ...FOLLOW_UP_ACTIVITY_TYPES,
] as const;
