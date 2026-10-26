/**
 * Pure decisions behind scripts/suppress-calendar-notification.ts. No I/O:
 * argument parsing and the refusal conditions live here so a unit test can
 * pin them. Nothing here mutates its inputs.
 */
export const CALENDAR_SENDER_ADDRESS = "calendar-notification@google.com";
export const CALENDAR_AUDIT_ACTION = "suppress_calendar_notification";

/** Rows that hang off the person and what deleting it does to them (verified against pg_constraint). */
export interface CalendarBlastRadius {
  /** ON DELETE CASCADE: removed with the person. */
  activities: number;
  emailMessagePersonRows: number;
  tasks: number;
  meetings: number;
  scheduledEmails: number;
  signals: number;
  linkedinScrapeJobs: number;
  followUpQueueItems: number;
  personBdConnections: number;
  personIdMaps: number;
  propertyHistoryRows: number;
  lushaReveals: number;
  duplicateCandidates: number;
  mergeEvents: number;
  /** ON DELETE NO ACTION: a single row makes the DELETE fail, so it refuses up front. */
  sequenceMembers: number;
  /** ON DELETE SET NULL: these survive, only unlinked (distinct email_message rows that point at the person either way). */
  survivingEmailMessages: number;
  /** Activity count by type, for the owner's eyes. */
  activityTypes: Record<string, number>;
}

export interface CalendarPlanInput {
  /** Ids of the person rows whose normalized email equals the address. */
  personIds: readonly string[];
  /** Bd ids from the sync's own eligibility rule (getSyncableAccounts). */
  syncableBdIds: readonly string[];
  /** Bd ids that already hold the address rule. */
  alreadyRuledBdIds: readonly string[];
  blast: CalendarBlastRadius | null;
}

export type CalendarPlan =
  | { kind: "refuse"; reason: string }
  | { kind: "ok"; personId: string; addRuleBdIds: string[]; alreadyRuledBdIds: string[]; blast: CalendarBlastRadius };

export function planCalendarSuppression(input: CalendarPlanInput): CalendarPlan {
  if (input.personIds.length === 0) return { kind: "refuse", reason: `No person with ${CALENDAR_SENDER_ADDRESS} found: already removed, or never existed. Nothing written.` };
  if (input.personIds.length > 1) return { kind: "refuse", reason: `${input.personIds.length} persons match ${CALENDAR_SENDER_ADDRESS}; expected exactly one. Nothing written.` };
  if (input.syncableBdIds.length === 0) return { kind: "refuse", reason: "No syncable email account found: refusing to guess a BD set. Nothing written." };
  if (!input.blast) return { kind: "refuse", reason: "Blast radius was not measured. Nothing written." };
  if (input.blast.sequenceMembers > 0) {
    return { kind: "refuse", reason: `The person is a member of ${input.blast.sequenceMembers} sequence(s); sequence_member.person_id is ON DELETE NO ACTION, so the delete would fail. Nothing written.` };
  }
  const have = new Set(input.alreadyRuledBdIds);
  const syncable = [...new Set(input.syncableBdIds)];
  return {
    kind: "ok",
    personId: input.personIds[0]!,
    addRuleBdIds: syncable.filter((id) => !have.has(id)),
    alreadyRuledBdIds: syncable.filter((id) => have.has(id)),
    blast: input.blast,
  };
}

export function parseSuppressArgs(argv: readonly string[]): { execute: boolean; actor: string | null } {
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --actor=<bd id>`);
  }
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  if (!execute && actor) throw new Error("--actor only makes sense with --execute.");
  return { execute, actor };
}
