/**
 * One audit_log row per approval-side action, so who authorized or withdrew each send is recoverable. Pure row builder;
 * the callers insert it inside the same transaction as the change it describes.
 */
import type { NewAuditLog } from "@/db/schema";

export const SEQUENCE_AUDIT_ACTIONS = {
  approve: "sequence_member_approve",
  cancel: "sequence_member_cancel",
  discard: "sequence_member_discard",
  readmit: "sequence_member_readmit",
  regenerate: "sequence_member_regenerate",
  // A BD pressed "No contactar": the address is suppressed and this membership was discarded with reason opt_out.
  opt_out: "sequence_member_opt_out",
} as const;

export type SequenceAuditVerb = keyof typeof SEQUENCE_AUDIT_ACTIONS;

export type SequenceAuditInput = { actorBdId: string; personId: string; memberId: string; sequenceId: string; step?: number; at?: Date };

export function sequenceAuditRow(verb: SequenceAuditVerb, input: SequenceAuditInput): NewAuditLog & { at: Date } {
  const metadata: Record<string, unknown> = { memberId: input.memberId, sequenceId: input.sequenceId };
  if (input.step !== undefined) metadata.step = input.step;
  return { action: SEQUENCE_AUDIT_ACTIONS[verb], actorBdId: input.actorBdId, personId: input.personId, metadata, at: input.at ?? new Date() };
}
