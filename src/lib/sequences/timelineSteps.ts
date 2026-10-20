/**
 * The Sequence emails a Contact record shows in "Próximas": approved step 1 drafts of the VIEWER's own Sequences that have a
 * moment. They are managed from the Sequence (changing one from the record would skip its approval and pre-send checks), so
 * the card only links there. Pure; built from the memberships the record already reads.
 */
import type { ContactMembership } from "./contactContext";

export interface UpcomingSequenceStep {
  memberId: string;
  sequenceId: string;
  sequenceName: string;
  subject: string;
  toAddress: string | null;
  at: Date;
  approvedAt: Date | null;
}

export function upcomingSequenceSteps(memberships: readonly ContactMembership[]): UpcomingSequenceStep[] {
  return memberships
    .flatMap((m) =>
      m.state === "approved" && m.ownedByViewer && m.scheduledFor && m.sequenceId
        ? [{ memberId: m.memberId, sequenceId: m.sequenceId, sequenceName: m.sequenceName, subject: m.subject ?? "", toAddress: m.toAddress ?? null, at: m.scheduledFor, approvedAt: m.approvedAt ?? null }]
        : [],
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}
