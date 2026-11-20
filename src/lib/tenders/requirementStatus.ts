/**
 * What Avalith has for each requirement of the must-list, as the administrative area answers. THREE states, not a checkbox:
 * an unchecked box would mean both "nobody asked yet" (pending work) and "they said we do not have it" (a reason not to bid).
 * Conflating an absent value with a negative one is a recurring defect here, so the absent value is its own state.
 * 'pending' is never stored: a missing row IS pending. Pure and client-safe.
 */
import { MUST_LIST_ROWS } from "./mustList";

export const REQUIREMENT_STATUSES = ["pending", "have", "missing"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/** The eight stable keys of the must-list. The status is keyed by these, NEVER by the requirement's text (model output, rewritten on every re-analysis). */
export const REQUIREMENT_KEYS = MUST_LIST_ROWS.map(([key]) => key);
export type RequirementKey = (typeof MUST_LIST_ROWS)[number][0];

/** Only the decisions: a key that is not here is pending. */
export type RequirementStatuses = Partial<Record<RequirementKey, Exclude<RequirementStatus, "pending">>>;

export const isRequirementStatus = (v: unknown): v is RequirementStatus => typeof v === "string" && (REQUIREMENT_STATUSES as readonly string[]).includes(v);
export const isRequirementKey = (v: unknown): v is RequirementKey => typeof v === "string" && (REQUIREMENT_KEYS as readonly string[]).includes(v);

export const statusOf = (statuses: RequirementStatuses, key: RequirementKey): RequirementStatus => statuses[key] ?? "pending";

/** What the answer says in a few words ("vencido, lo renuevan en marzo"); the status carries the verdict, the note the reason. */
export const MAX_REQUIREMENT_NOTE_CHARS = 200;

/** Notes keyed by requirement key; a key that is absent has no note. Independent of the status. */
export type RequirementNotes = Partial<Record<RequirementKey, string>>;

/** Trimmed and capped; blank means "no note". Pure, so the input and the server share it. */
export function normalizeRequirementNote(raw: string): string | null {
  const t = raw.trim().slice(0, MAX_REQUIREMENT_NOTE_CHARS);
  return t === "" ? null : t;
}

/**
 * THE rule for whether a requirement keeps its row: it is deleted only when the status is 'pending' AND there is no note.
 * 'pending' alone used to delete the row, but "administration is looking into it" is a real note on an unanswered requirement.
 */
export const keepsRequirementRow = (status: RequirementStatus, note: string | null): boolean => status !== "pending" || note !== null;

export interface RequirementRowState {
  status: RequirementStatus;
  note: string | null;
}

/** `status` and `note` are independent: an absent field leaves the stored value alone (an empty `note` clears it). */
export interface RequirementChange {
  status?: RequirementStatus;
  note?: string;
}

export interface RequirementWritePlan extends RequirementRowState {
  op: "upsert" | "delete";
  statusChanged: boolean;
  noteChanged: boolean;
}

/** From the stored row (undefined = no row = pending, no note) and the requested change to what to write and what to log. */
export function planRequirementWrite(old: RequirementRowState | undefined, change: RequirementChange): RequirementWritePlan {
  const before: RequirementRowState = old ?? { status: "pending", note: null };
  const status = change.status ?? before.status;
  const note = change.note === undefined ? before.note : normalizeRequirementNote(change.note);
  return { op: keepsRequirementRow(status, note) ? "upsert" : "delete", status, note, statusChanged: status !== before.status, noteChanged: note !== before.note };
}
