/**
 * Pure guards for scripts/release-bd-ownership.ts — releasing a departing
 * BD's book of business so their records end up with NO owner instead of an
 * owner who can no longer sign in.
 *
 * WHY THIS IS A TESTED MODULE AND NOT AN INLINE CHECK: the write it guards is
 * undone by a cron if one detail is missed, and the undo is silent.
 *
 * `person.owner_bd_id` is recomputed every night at 03:00 ART under the
 * last-worked rule (src/app/api/owners/recompute/route.ts, the same code as
 * scripts/backfill-owner-last-worked.ts). That rule skips exactly one thing:
 * a person carrying a MANUAL owner marker — a `person_property_history` row
 * with property 'ownerBdId' and source 'edit'
 * (src/lib/identity/ownerRule.ts#hasManualOwner). A departing BD is, by
 * definition, the BD who worked most of these people LAST, so a release
 * without that marker is handed straight back to her on the next run.
 *
 * And it fails louder than just reverting: the cron refuses any run over
 * OWNER_CRON_MAX_CHANGES (25) changes. Releasing thousands of people with no
 * markers would make the nightly recompute plan thousands of changes, blow
 * the cap and answer 500 — every night, until somebody noticed. So the marker
 * is not bookkeeping. It is what keeps both the data and the cron working.
 */

/**
 * The ids about to be released that would NOT carry a manual-owner marker.
 * Must be empty before the write runs: every id in `toUpdate` needs a row in
 * `history`, or the cron above re-owns exactly those.
 *
 * Pure; never mutates its inputs.
 */
export function unmarkedReleases(
  toUpdate: readonly string[],
  history: readonly { personId: string }[],
): string[] {
  const marked = new Set(history.map((h) => h.personId));
  return toUpdate.filter((id) => !marked.has(id));
}

export interface ReleaseVerification {
  ok: boolean;
  /** Null when ok; otherwise what is wrong, phrased for an operator reading a terminal. */
  problem: string | null;
}

/**
 * Read-back check, run AFTER the transaction commits, against numbers read
 * fresh from the database — not against what the writer believed it did.
 *
 * Two independent ways this operation can report success while having failed:
 * rows that still point at the departing BD, and released rows with no
 * sticky marker (alive today, re-owned at 03:00).
 */
export function verifyPersonRelease(input: {
  releasedCount: number;
  remainingOwned: number;
  markersWritten: number;
}): ReleaseVerification {
  if (input.remainingOwned !== 0) {
    return {
      ok: false,
      problem: `${input.remainingOwned} person row(s) still point at the departing BD after the release.`,
    };
  }
  if (input.markersWritten < input.releasedCount) {
    return {
      ok: false,
      problem:
        `${input.markersWritten} manual-owner marker(s) were written for ${input.releasedCount} released person(s). ` +
        "The unmarked ones are NOT released: the nightly owner recompute will hand them back to the departing BD, " +
        "and a change set that large will also blow the cron's 25-change cap and fail the whole run.",
    };
  }
  return { ok: true, problem: null };
}
