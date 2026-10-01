import { createHash } from "node:crypto";

/**
 * Audit row for "a BD saved or cleared their email signature". `bd` has no
 * history table, so this follows the neighbouring convention for per-BD
 * account mutations: one `audit_log` row (same table as `bd_password_reset`,
 * `owner_change`), written in the SAME transaction as the `bd` update
 * (signature/saveDb.ts). A BD only ever edits their own signature, so the
 * actor and the target are the same BD.
 *
 * The signature itself is NOT copied into the log: it is operator markup,
 * can be large, and the audit answers "who changed it, when, and from what
 * size to what size". `afterSha256` lets someone confirm a given HTML is
 * what was saved without keeping the content.
 */
export const SIGNATURE_AUDIT_ACTION = "bd_signature_update";

export interface SignatureAuditInput {
  actorBdId: string;
  /** Stored value before the save (null = none). */
  before: string | null;
  /** Value stored by the save (null = cleared). */
  after: string | null;
}

export interface SignatureAuditRow {
  actorBdId: string;
  action: typeof SIGNATURE_AUDIT_ACTION;
  targetBdId: string;
  metadata: { cleared: boolean; beforeLength: number; afterLength: number; afterSha256: string | null };
}

export function buildSignatureAuditRow(input: SignatureAuditInput): SignatureAuditRow {
  const { actorBdId, before, after } = input;
  return {
    actorBdId,
    action: SIGNATURE_AUDIT_ACTION,
    targetBdId: actorBdId,
    metadata: {
      cleared: after === null,
      beforeLength: before?.length ?? 0,
      afterLength: after?.length ?? 0,
      afterSha256: after === null ? null : createHash("sha256").update(after).digest("hex"),
    },
  };
}
