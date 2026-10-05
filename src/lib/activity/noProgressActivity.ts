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
export const NO_PROGRESS_ACTIVITY_TYPES = ["call_attempt"] as const;
