/**
 * The decisions the Sequence detail screen's container makes, as pure functions over injected effects. The components
 * only REPORT intent (see _components/actions.ts); this is where an intent becomes a sequence of server calls, so the
 * rules that protect the BD are tested without a browser:
 *
 *  - An approval binds to the exact text, so "Aprobar y programar" SAVES what the form holds and approves only if that
 *    save succeeded. A failed or thrown save must never fall through to an approval.
 *  - The bulk gate and the "Aprobar los N listos" selection are computed from the rows the page was last given, so a
 *    refetch (after the dialog reports "reviewed") is what moves the "N de M revisados" counter.
 */
import type { ApprovalRejection, ApproveResult } from "./approvalQueries";
import type { DetailMember } from "./detailQueries";
import type { GateRow } from "./bulkApprovalGate";
import type { SaveEditResult } from "./draftQueries";
import { mapMemberCard, type CardActionId } from "./memberCard";
import { memberDraftMismatch } from "./audienceCard";

export type ReviewText = { subject: string; body: string };
export type ReviewFlowError = Extract<SaveEditResult, { ok: false }>["error"] | Extract<ApproveResult, { error: "rejected" }>["rejected"][number]["reason"] | "too_many" | "failed";
/** `persisted`: the server now holds the text the form held, so the page should refetch even when the intent failed. */
export type ReviewFlowResult = { ok: true; persisted: boolean } | { ok: false; error: ReviewFlowError; persisted: boolean };

export interface ReviewPorts {
  save: () => Promise<SaveEditResult>;
  approve: () => Promise<ApproveResult>;
}

/** The one reason to show for a single refused approval: the first rejection, or the request-level refusal. */
export const refusalKey = (refused: Extract<ApproveResult, { ok: false }>): ReviewFlowError => (refused.error === "too_many" ? "too_many" : refused.rejected[0]?.reason ?? "failed");

export const sameContent = (a: ReviewText, b: ReviewText) => a.subject === b.subject && a.body === b.body;

export async function runReviewIntent(intent: "save" | "approve", input: { stored: ReviewText; text: ReviewText }, ports: ReviewPorts): Promise<ReviewFlowResult> {
  // "Guardar" always goes to the server. "Aprobar" skips the save for untouched text: saving would clear the review and
  // the approval for nothing, and there is nothing new to bind the approval to.
  let persisted = false;
  if (intent === "save" || !sameContent(input.stored, input.text)) {
    try {
      const saved = await ports.save();
      if (!saved.ok) return { ok: false, error: saved.error, persisted: false };
      persisted = true;
    } catch {
      return { ok: false, error: "failed", persisted: false };
    }
  }
  if (intent === "save") return { ok: true, persisted };
  try {
    const approved = await ports.approve();
    if (approved.ok) return { ok: true, persisted };
    return { ok: false, error: refusalKey(approved), persisted };
  } catch {
    return { ok: false, error: "failed", persisted };
  }
}

/** "Aprobar los N listos": N = drafted members with a draft, the same set the header counts, minus the drafts in another language (they cannot be selected). */
export const readyMemberIds = (members: readonly DetailMember[]): string[] => members.filter((m) => m.state === "drafted" && m.draft !== null && !memberDraftMismatch(m)).map((m) => m.memberId);

/** Bulk-bar rows for the selected ids. An id that left the roster or stopped being a drafted member is dropped, not counted. */
export function gateRows(members: readonly DetailMember[], selected: readonly string[]): GateRow[] {
  const byId = new Map(members.map((m) => [m.memberId, m]));
  return selected.flatMap((id) => {
    const m = byId.get(id);
    return m && m.state === "drafted" && m.draft ? [{ id, reviewed: m.draft.reviewedAt !== null, wrongLanguage: memberDraftMismatch(m) !== null }] : [];
  });
}

/** Which draft a card action refers to: only the reminder action means step 2. */
export const cardStep = (action: CardActionId): 1 | 2 => (action === "reviewReminder" || action === "viewReminder" ? 2 : 1);

/** "Aprobar" on a card: the reminder when the card is the reminder-due-today card, step 1 otherwise. */
export function approveStep(m: DetailMember, now: Date): 1 | 2 {
  const card = mapMemberCard({ state: m.state, hasDraft: m.draft !== null, holdReason: m.holdReason, reminderDueAt: m.reminderDueAt, florida: m.florida, discardReason: m.discardReason }, now);
  return card.kind === "reminderToday" ? 2 : 1;
}

/** The member states whose draft Regenerar may replace, per step. The server uses the same lists, so client and server agree on who is touched. */
export const REGENERABLE_STATES: Record<1 | 2, readonly string[]> = { 1: ["drafted", "approved"], 2: ["sent"] };

/** At most this many names are written per refusal reason; the rest are counted. */
export const REFUSAL_NAMES_SHOWN = 3;
export type RefusalGroup = { reason: ApprovalRejection["reason"]; names: string[]; more: number };

/**
 * What a bulk refusal tells the BD: one group per distinct reason (first-seen order) with up to REFUSAL_NAMES_SHOWN
 * members named and the count of the others. A member is named by its person name, else its email; one with neither, or
 * an id the page does not hold, is not named and counts toward `more`. Pure: neither argument is mutated.
 */
export function summarizeRefusals(rejected: readonly ApprovalRejection[], members: readonly Pick<DetailMember, "memberId" | "firstName" | "lastName" | "email">[]): RefusalGroup[] {
  const byId = new Map(members.map((m) => [m.memberId, m]));
  const groups = new Map<ApprovalRejection["reason"], { names: string[]; total: number }>();
  for (const r of rejected) {
    const group = groups.get(r.reason) ?? { names: [], total: 0 };
    groups.set(r.reason, group);
    group.total += 1;
    const m = byId.get(r.memberId);
    const name = m ? [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email : null;
    if (name && group.names.length < REFUSAL_NAMES_SHOWN) group.names.push(name);
  }
  return [...groups].map(([reason, g]) => ({ reason, names: g.names, more: g.total - g.names.length }));
}
