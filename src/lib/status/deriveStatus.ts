/**
 * Pure status-derivation algorithm (design.md "Status derivation (R4)";
 * contact-record spec "Status is read-only, derived"; contact-list spec
 * "Table/board toggle with activity-driven status changes"). `person.status`
 * is a CACHE, never edited directly — this function is the only rule that
 * decides what it should be, from the person's recorded activity and
 * connections:
 *
 *   rank: new 0 < contacted 1 < replied 2 < meeting 3
 *   events  = activities(person) + connections(person).{sentCount>0 ->
 *             contacted, receivedCount>0 -> replied}
 *   stage   = max rank over events (combined across BDs)
 *   status  = latest `discarded` is newer than every stage event
 *             ? discarded : stage
 *
 * Any activity logged after a discard un-discards the Contact (owner
 * decision, 2026-09-24) — a discard is not "sticky" once something newer
 * happened. The DB-only caller builds `events` from real `activity` and
 * `person_bd_connection` rows (see the `activityToStatusEvent` mapping in
 * this same module) and passes them here; this function touches no I/O and
 * is fully unit-testable.
 */

export type StatusStage = "new" | "contacted" | "replied" | "meeting";
export type PersonStatus = StatusStage | "discarded";

/** Rank used to pick the most advanced stage across every event (design R4). */
const STAGE_RANK: Record<StatusStage, number> = {
  new: 0,
  contacted: 1,
  replied: 2,
  meeting: 3,
};

/** Points the record page's "why" hint at the event that produced `status` (design D4). */
export type StatusBecause =
  | { source: "activity"; activityId: string }
  | { source: "connection"; bdId: string };

export interface DerivedStatus {
  status: PersonStatus;
  because: StatusBecause | null;
}

/**
 * One recorded `activity` row's contribution — `status` is only present for
 * `status_change`/`status_backfill` rows (their `metadata.status`) or
 * `discarded` rows (always `"discarded"`); other types (`note`,
 * `hunter_lookup`, `email_sent`, `meeting_logged`, ...) are recognized by
 * `type` alone. `at` is the event's effective time: `createdAt` for a normal
 * activity, or the backfilled `originalAt` for a `status_backfill` row (see
 * `activityToStatusEvent` below) so a migrated historical correction sorts
 * where it actually happened, not when the migration ran.
 */
export interface ActivityStatusEvent {
  kind: "activity";
  id: string;
  type: string;
  at: Date;
  status?: PersonStatus;
}

/**
 * One BD's connection facts for this person (design D2/`person_bd_connection`).
 * `at` is that connection's `lastMessageAt` — the closest thing a
 * message-derived signal has to "when this evidence happened", used only to
 * compare against a discard's timestamp. Null when no message has ever been
 * exchanged (sentCount and receivedCount are then necessarily both 0, so the
 * connection contributes no stage event either way).
 */
export interface ConnectionStatusEvent {
  kind: "connection";
  bdId: string;
  sentCount: number;
  receivedCount: number;
  at: Date | null;
}

export type StatusEvent = ActivityStatusEvent | ConnectionStatusEvent;

// Activity types that unconditionally advance the stage to a fixed rank.
// `status_change`/`status_backfill` are handled separately below because
// their stage comes from `metadata.status`, not from the type itself.
const FIXED_STAGE_BY_TYPE: Partial<Record<string, StatusStage>> = {
  email_sent: "contacted",
  reply_received: "replied",
  meeting_logged: "meeting",
};

interface StageCandidate {
  rank: number;
  at: Date;
  because: StatusBecause;
}

interface DiscardCandidate {
  at: Date;
  because: StatusBecause;
}

function activityStageCandidate(event: ActivityStatusEvent): StageCandidate | null {
  const fixed = FIXED_STAGE_BY_TYPE[event.type];
  if (fixed) {
    return { rank: STAGE_RANK[fixed], at: event.at, because: { source: "activity", activityId: event.id } };
  }
  if ((event.type === "status_change" || event.type === "status_backfill") && event.status && event.status !== "discarded") {
    return {
      rank: STAGE_RANK[event.status],
      at: event.at,
      because: { source: "activity", activityId: event.id },
    };
  }
  return null;
}

function activityDiscardCandidate(event: ActivityStatusEvent): DiscardCandidate | null {
  const isDiscard =
    event.type === "discarded" ||
    ((event.type === "status_change" || event.type === "status_backfill") && event.status === "discarded");
  if (!isDiscard) return null;
  return { at: event.at, because: { source: "activity", activityId: event.id } };
}

function connectionStageCandidate(event: ConnectionStatusEvent): StageCandidate | null {
  if (!event.at) return null;
  if (event.receivedCount > 0) {
    return { rank: STAGE_RANK.replied, at: event.at, because: { source: "connection", bdId: event.bdId } };
  }
  if (event.sentCount > 0) {
    return { rank: STAGE_RANK.contacted, at: event.at, because: { source: "connection", bdId: event.bdId } };
  }
  return null;
}

/** Later candidate wins; a strictly higher rank always wins regardless of time (design: "stage = max rank over events"). */
function pickHigherStage(a: StageCandidate | null, b: StageCandidate): StageCandidate {
  if (!a) return b;
  if (b.rank !== a.rank) return b.rank > a.rank ? b : a;
  return b.at >= a.at ? b : a;
}

function pickLaterDiscard(a: DiscardCandidate | null, b: DiscardCandidate): DiscardCandidate {
  if (!a) return b;
  return b.at >= a.at ? b : a;
}

export function deriveStatus(events: readonly StatusEvent[]): DerivedStatus {
  let stage: StageCandidate | null = null;
  let discard: DiscardCandidate | null = null;

  for (const event of events) {
    if (event.kind === "activity") {
      const stageCandidate = activityStageCandidate(event);
      if (stageCandidate) stage = pickHigherStage(stage, stageCandidate);
      const discardCandidate = activityDiscardCandidate(event);
      if (discardCandidate) discard = pickLaterDiscard(discard, discardCandidate);
    } else {
      const stageCandidate = connectionStageCandidate(event);
      if (stageCandidate) stage = pickHigherStage(stage, stageCandidate);
    }
  }

  // "latest discarded is newer than every stage event" — vacuously true when
  // there is no stage event at all, so a bare discard (even on a Contact
  // with zero recorded activity) still lands on `discarded`.
  const discardWins = discard !== null && (stage === null || discard.at >= stage.at);
  if (discardWins) {
    return { status: "discarded", because: discard!.because };
  }

  if (!stage) return { status: "new", because: null };
  const stageKey = (Object.keys(STAGE_RANK) as StatusStage[]).find((k) => STAGE_RANK[k] === stage!.rank)!;
  return { status: stageKey, because: stage.because };
}
