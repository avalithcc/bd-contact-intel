/**
 * DB queries for the per-BD "never log" list (email-sync brief, owner
 * decision 2026-09-30). The settings UI ships later behind a mockup; this
 * gives it (and the sync matcher) one place to read/write
 * `email_never_log` rows. Pure normalization lives in neverLogRules.ts.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailNeverLog, type EmailNeverLog } from "@/db/schema";
import type { NeverLogRule } from "@/lib/gmail/classify";
import { normalizeNeverLogValue, type NeverLogKind } from "@/lib/gmail/neverLogRules";

export type { NeverLogKind } from "@/lib/gmail/neverLogRules";
export { normalizeNeverLogValue } from "@/lib/gmail/neverLogRules";

/** Every never-log rule for one BD, in the shape src/lib/gmail/classify.ts expects. */
export async function getNeverLogRules(bdId: string): Promise<NeverLogRule[]> {
  const rows = await db
    .select({ kind: emailNeverLog.kind, value: emailNeverLog.value })
    .from(emailNeverLog)
    .where(eq(emailNeverLog.bdId, bdId));
  return rows.map((r) => ({ kind: r.kind as NeverLogKind, value: r.value }));
}

export async function listNeverLogEntries(bdId: string): Promise<EmailNeverLog[]> {
  return db.select().from(emailNeverLog).where(eq(emailNeverLog.bdId, bdId));
}

export async function addNeverLogEntry(bdId: string, kind: NeverLogKind, rawValue: string): Promise<void> {
  const value = normalizeNeverLogValue(kind, rawValue);
  await db.insert(emailNeverLog).values({ bdId, kind, value }).onConflictDoNothing();
}

export async function removeNeverLogEntry(bdId: string, id: string): Promise<void> {
  await db.delete(emailNeverLog).where(and(eq(emailNeverLog.id, id), eq(emailNeverLog.bdId, bdId)));
}
