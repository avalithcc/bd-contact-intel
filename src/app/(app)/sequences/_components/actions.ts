import type { CardActionId } from "@/lib/sequences/memberCard";
import type { SendChoice } from "@/lib/sequences/sendMoment";

/**
 * What a control on the detail screen asks for. The components only report intent: the container that mounts them
 * (SequenceDetailScreen, NewSequenceScreen, ContactSequenceBlock) decides whether it opens a dialog (PR 12) or calls an existing server action in actions.ts.
 */
export type DetailAction =
  | { type: "editSequence" | "approveReady" | "changeCadence" | "createNext" }
  | { type: CardActionId; memberId: string }
  /** The split button on a draft card: approve with the BD's choice (now, a chosen time, or the cadence). */
  | { type: "approveWith"; memberId: string; when: SendChoice }
  /** "Cambiar" (a chosen time) or "Enviar ahora" on an approved card. */
  | { type: "reschedule"; memberId: string; when: SendChoice }
  /** The card's "idioma" menu: open the language dialog for this member, or clear the stored choice. */
  | { type: "chooseLanguage" | "resetLanguage"; memberId: string }
  /** "Mantener en {idioma}" on a draft in another language: record the draft's own language as this member's one-off choice. Generates nothing. */
  | { type: "keepLanguage"; memberId: string }
  /** Only asks to start: the confirmation is `OptOutDialog`, which states the scope before anything is recorded. */
  | { type: "optOut"; memberId: string };
/** May answer with a promise of `true` once the server accepted it: a popover that asked for it then closes. */
export type OnAction = (action: DetailAction) => void | Promise<boolean | void>;

/**
 * What the review dialog asks for. `save` and `approve` carry the text as it stands in the form: the container saves
 * it (saveSequenceDraft) and, for `approve`, approves only after that save succeeded, because an approval binds to the
 * exact content. `markReviewed` is reported once when a draft nobody opened is opened (markDraftReviewed).
 */
export type ReviewAction =
  /** `version` is draftVersion() of the text the dialog showed: the server refuses the mark when the stored text moved on. */
  | { type: "markReviewed"; memberId: string; step: 1 | 2; version: string }
  /** "Ver la versión actual" after a refused mark: refetch, then the dialog shows (and reports) the stored text. */
  | { type: "reloadCurrent"; memberId: string; step: 1 | 2 }
  /** "Mantener en {idioma}" in the review dialog (see DetailAction). */
  | { type: "keepLanguage"; memberId: string; step: 1 | 2 }
  /** `confirmedEdits` (member id -> the `editedAt` the BD was shown) is set only after the BD confirmed losing exactly that text; the server refuses to overwrite an edit otherwise. */
  | { type: "regenerate"; memberId: string; step: 1 | 2; confirmedEdits?: Record<string, number> }
  | { type: "save"; memberId: string; step: 1 | 2; subject: string; body: string }
  /** `when` is the split-button choice; absent for the reminder (step 2), which has no choice. */
  | { type: "approve"; memberId: string; step: 1 | 2; subject: string; body: string; when?: SendChoice };
export type OnReviewAction = (action: ReviewAction) => void | Promise<unknown>;

/** What the bulk bar asks for. `remove` only asks to start: the reason is collected by `RemoveReasonDialog`. */
export type BulkAction = { type: "remove"; memberIds: string[] } | { type: "approve"; memberIds: string[]; when: SendChoice };
export type OnBulkAction = (action: BulkAction) => void | Promise<boolean | void>;

/** What the Contact-record block asks for. Same rule as `optOut` above: the container opens `OptOutDialog`, then calls recordOptOutForMember. */
export type ContactContextAction = { type: "optOut"; memberId: string };
export type OnContactContextAction = (action: ContactContextAction) => void;

/**
 * What the create form asks for. The values are the validated ones, in selection order; the container creates the
 * Sequence (createSequenceRow) and then adds the members (addMembersToSequence), which re-run every rule server-side and
 * report each refused Contact, so nothing the form shows is trusted.
 */
export type CreateSequenceIntent = { name: string; dailySendCap: number; personIds: string[] };
export type OnCreateSequence = (intent: CreateSequenceIntent) => void;
