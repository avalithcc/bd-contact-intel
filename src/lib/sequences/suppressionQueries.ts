/**
 * Thin DB layer over email_suppression (company-wide, no bd_id). Pure matching lives in suppression.ts; this file only
 * reads rules and inserts idempotently. Nothing calls it yet (PR 5 roster, PR 8 runner, PR 4 unsubscribe).
 */
import { db } from "@/db";
import { emailSuppression } from "@/db/schema";
import {
  normalizeSuppressionValue,
  type SuppressionKind,
  type SuppressionRule,
} from "@/lib/sequences/suppression";

export type SuppressionSource = "unsubscribe_link" | "manual" | "reply";

export interface SuppressionInsert {
  kind: SuppressionKind;
  rawValue: string;
  source: SuppressionSource;
  recordedByBdId?: string | null;
  personId?: string | null;
  sequenceMemberId?: string | null;
}

/** Every suppression rule, company-wide, in the shape isSuppressed() expects. */
export async function listSuppressionRules(): Promise<SuppressionRule[]> {
  const rows = await db
    .select({ kind: emailSuppression.kind, value: emailSuppression.value })
    .from(emailSuppression);
  return rows.map((r) => ({ ruleKind: r.kind as SuppressionKind, value: r.value }));
}

/**
 * Records a suppression. Idempotent: a repeat of the same (kind, value) changes nothing and keeps the original
 * provenance. Returns true when a new row was written.
 */
export async function insertSuppression(input: SuppressionInsert): Promise<boolean> {
  const inserted = await db
    .insert(emailSuppression)
    .values({
      kind: input.kind,
      value: normalizeSuppressionValue(input.kind, input.rawValue),
      source: input.source,
      recordedByBdId: input.recordedByBdId ?? null,
      personId: input.personId ?? null,
      sequenceMemberId: input.sequenceMemberId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: emailSuppression.id });
  return inserted.length > 0;
}
