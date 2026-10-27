/**
 * Clearing a hold when a draft stops being the approved one. Only the holds that describe the DRAFT (DRAFT_HOLD_REASONS) go with it: a
 * send-side hold (a Gmail 5xx `manual_check`, `send_failed`, `suppressed`, `merged_contact` ...) says something about the send, which an edit,
 * a regenerate or a cancelled approval does not undo, so it stays on the member. Evaluated in SQL against the row's CURRENT reason, inside the
 * caller's transaction, so no read-then-write gap exists. `hold_at` follows `hold_reason` (both read the old row in one UPDATE).
 */
import { sql } from "drizzle-orm";
import { sequenceMember } from "@/db/schema";
import { DRAFT_HOLD_REASONS } from "./preSendChecks";

const draftDriven = sql`${sequenceMember.holdReason} in (${sql.join(DRAFT_HOLD_REASONS.map((r) => sql`${r}`), sql`, `)})`;

/** The `set` fragment for `tx.update(sequenceMember)`: nulls hold_reason / hold_at only when the current reason is draft-driven. */
export const clearDraftHold = () => ({
  holdReason: sql`case when ${draftDriven} then null else ${sequenceMember.holdReason} end`,
  holdAt: sql`case when ${draftDriven} then null else ${sequenceMember.holdAt} end`,
});
