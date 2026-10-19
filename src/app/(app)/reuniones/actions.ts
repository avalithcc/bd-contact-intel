"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import { isUuid } from "@/lib/uuid";
import { sanitizeOutcomeInput } from "@/lib/meetings/actionInput";
import { applyMeetingOutcome, undoMeetingOutcome } from "@/lib/meetings/db";
import { MeetingOutcomeError, type MeetingOutcomeErrorReason } from "@/lib/meetings/outcome";
import type { OutcomeChoice } from "@/lib/meetings/status";

export type MeetingActionReason = MeetingOutcomeErrorReason | "unexpected";

export type ConfirmMeetingResult =
  | { ok: true; outcome: OutcomeChoice; followUpTaskCreated: boolean }
  | { ok: false; reason: MeetingActionReason };

export type UndoMeetingResult = { ok: true } | { ok: false; reason: MeetingActionReason };

function failure(err: unknown): { ok: false; reason: MeetingActionReason } {
  if (err instanceof MeetingOutcomeError) return { ok: false, reason: err.reason };
  console.error("[meetings] unexpected action error", err);
  return { ok: false, reason: "unexpected" };
}

function revalidateMeetingPaths(personId: string): void {
  revalidatePath("/reuniones");
  revalidatePath("/tasks");
  revalidatePath(`/contacts/${personId}`);
  revalidatePath("/contacts");
}

/**
 * The outcome dialog's save (Se hizo / No se presentó / Reprogramada / Cancelada), from the Reuniones page and from the
 * contact record. Ownership is enforced in the write itself (planOutcome): only the BD who owns the meeting can close it, an
 * admin included. The payload is shape-checked first because a server action receives whatever the client sent.
 */
export async function confirmMeetingOutcomeAction(meetingId: string, raw: unknown): Promise<ConfirmMeetingResult> {
  try {
    const me = await getCurrentBd();
    if (!isUuid(meetingId)) return { ok: false, reason: "meeting_not_found" };
    const dict = await getDictionary();
    const result = await applyMeetingOutcome(meetingId, me.id, sanitizeOutcomeInput(raw), {
      no_show: dict.meetings.followUpTitleNoShow,
      cancelled: dict.meetings.followUpTitleCancelled,
    });
    revalidateMeetingPaths(result.personId);
    return { ok: true, outcome: result.outcome, followUpTaskCreated: result.followUpTaskId !== null };
  } catch (err) {
    // A redirect()/notFound() from getCurrentBd() must reach Next's router, not turn into a result.
    unstable_rethrow(err);
    return failure(err);
  }
}

/** The toast's "Deshacer": see the undo rule in src/lib/meetings/outcome.ts. */
export async function undoMeetingOutcomeAction(meetingId: string): Promise<UndoMeetingResult> {
  try {
    const me = await getCurrentBd();
    if (!isUuid(meetingId)) return { ok: false, reason: "meeting_not_found" };
    const { personId } = await undoMeetingOutcome(meetingId, me.id);
    revalidateMeetingPaths(personId);
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    return failure(err);
  }
}
