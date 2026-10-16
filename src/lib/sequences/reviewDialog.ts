/**
 * What the review dialog shows and offers for one member and step ("Revisar borrador", "Ver correo", "Ver correo
 * enviado", "Revisar recordatorio" are one dialog). Pure and string-free: it returns kinds and instants, and the
 * component words them through the `sequences` dictionary.
 *
 *  - Read-only once the email went out (`sent`/`replied`/`no_reply` for step 1) or the sequence stopped for the member.
 *  - An approved draft is editable, but only to cancel the send: "Aprobar" is not offered on what is already approved.
 *  - Only a draft nobody opened yet reports "mark reviewed", so reopening never rewrites the flag.
 *  - `edited`/`editedAt` say the draft is the BD's own text. They only word the notice: whether "Regenerar" needs a
 *    confirmation is decided by the SERVER (regenerateDrafts reports the edits it refused to overwrite), never here.
 *  - The dialog never says WHO approved or edited: the read does not carry it (see MemberCard's ownView note).
 */
import type { DetailDraft, DetailMember } from "./detailQueries";
import type { MemberState } from "./memberState";
import { reminderDueAt, step1DueAt, type Schedule } from "./schedule";

export type ReviewKind = "draft" | "approved" | "reminder" | "sent" | "stopped";
export type ReviewFooterId = "regenerate" | "save" | "approve";
export type ReviewCadence = { step1: { kind: "sent" | "scheduled" | "ifApprovedNow"; at: Date }; reminderAt: Date };
/** `cadence` is null for `stopped`: there is no send to describe, and projecting one would invent a future that is not coming. */
export type ReviewView = { kind: ReviewKind; readOnly: boolean; footer: ReviewFooterId[]; marksReviewed: boolean; edited: boolean; editedAt: Date | null; draft: DetailDraft; cadence: ReviewCadence | null };

const STOPPED: readonly MemberState[] = ["replied", "no_reply", "discarded"];

function kindOf(m: DetailMember, step: 1 | 2, draft: DetailDraft): ReviewKind {
  // `stopped` vs `sent` turns on whether the mail ACTUALLY went out, not on the state alone: a member discarded
  // from `drafted` or `approved` never sent anything, and telling that reader "this email already went out" — plus a
  // cadence projection for a send that will never happen — is two falsehoods on one screen.
  if (STOPPED.includes(m.state) || (step === 1 && m.state === "sent")) return m.sentAt ? "sent" : "stopped";
  if (step === 2) return draft.approvedAt ? "approved" : "reminder";
  return m.state === "approved" ? "approved" : "draft";
}

function cadenceOf(m: DetailMember, kind: ReviewKind, draft: DetailDraft, step: 1 | 2, schedule: Schedule, now: Date): ReviewCadence {
  if (m.sentAt && (step === 2 || kind === "sent")) return { step1: { kind: "sent", at: m.sentAt }, reminderAt: m.reminderDueAt ?? reminderDueAt(m.sentAt, schedule) };
  const scheduled = kind === "approved" ? draft.scheduledFor ?? (draft.approvedAt ? step1DueAt(draft.approvedAt, schedule) : null) : null;
  const at = scheduled ?? step1DueAt(now, schedule);
  return { step1: { kind: scheduled ? "scheduled" : "ifApprovedNow", at }, reminderAt: reminderDueAt(at, schedule) };
}

/** Null when the member has no draft for that step: there is nothing to open. */
export function reviewView(m: DetailMember, step: 1 | 2, schedule: Schedule, now: Date): ReviewView | null {
  const draft = step === 2 ? m.reminderDraft : m.draft;
  if (!draft) return null;
  const kind = kindOf(m, step, draft);
  const readOnly = kind === "sent" || kind === "stopped";
  const footer: ReviewFooterId[] = readOnly ? [] : kind === "approved" ? ["regenerate", "save"] : ["regenerate", "save", "approve"];
  const edited = draft.edited;
  return { kind, readOnly, footer, edited, editedAt: draft.editedAt, marksReviewed: (kind === "draft" || kind === "reminder") && draft.reviewedAt === null, draft, cadence: kind === "stopped" ? null : cadenceOf(m, kind, draft, step, schedule, now) };
}
