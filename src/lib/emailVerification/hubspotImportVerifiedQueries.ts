/**
 * DB-backed reads/writes for scripts/backfill-hubspot-email-verified.ts.
 * Not unit-tested directly (imports `db`) — the row-selection predicate and
 * audit metadata shape are tested in isolation in
 * tests/unit/hubspotImportVerifiedBackfill.test.ts, and this module's SQL
 * `WHERE` mirrors that predicate exactly.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, person, personPropertyHistory } from "@/db/schema";
import {
  buildHubspotEmailVerifiedBackfillAuditMetadata,
  HUBSPOT_IMPORT_EMAIL_SOURCE,
  PROBABLE_EMAIL_STATUS,
  VERIFIED_EMAIL_STATUS,
} from "@/lib/emailVerification/hubspotImportVerifiedBackfill";

const HISTORY_INSERT_BATCH_SIZE = 500;

export interface ProbableEmailSourceBreakdown {
  emailSource: string | null;
  count: number;
  /** Rows in this group whose `person.source_key` is NOT `'hubspot_import'`
   * — surfaces any disagreement between the two columns for the owner
   * before the write runs (email_source scopes this correction, source_key
   * does not). Only meaningful for the `hubspot_import` emailSource row. */
  sourceKeyDisagreeing: number;
}

/** One grouped read (one round trip): every distinct `email_source` among
 * currently-`'probable'` person rows, with a count and a same-group
 * disagreement count against `source_key`. This is the dry-run report AND
 * doubles as the pre-write sanity check. */
export async function readProbableEmailSourceBreakdown(): Promise<ProbableEmailSourceBreakdown[]> {
  const rows = await db
    .select({
      emailSource: person.emailSource,
      count: sql<string>`count(*)`,
      sourceKeyDisagreeing: sql<string>`count(*) filter (where ${person.sourceKey} is distinct from ${HUBSPOT_IMPORT_EMAIL_SOURCE})`,
    })
    .from(person)
    .where(eq(person.emailStatus, PROBABLE_EMAIL_STATUS))
    .groupBy(person.emailSource);

  return rows.map((r) => ({
    emailSource: r.emailSource,
    count: Number(r.count),
    sourceKeyDisagreeing: Number(r.sourceKeyDisagreeing),
  }));
}

export interface HubspotEmailVerifiedBackfillResult {
  updatedPersonIds: string[];
}

/**
 * Executes the relabel in one transaction: a single scoped `UPDATE ...
 * WHERE` (not a fetch-then-update-by-id loop — the predicate alone is
 * index-friendly via `person_email_status_idx`), a batched
 * `person_property_history` insert recording the change (old value is
 * always `'probable'`, guaranteed by the `WHERE` clause — no extra read
 * needed to know it), and one `audit_log` row in the same transaction.
 */
export async function executeHubspotEmailVerifiedBackfill(
  actorBdId: string,
): Promise<HubspotEmailVerifiedBackfillResult> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(person)
      .set({ emailStatus: VERIFIED_EMAIL_STATUS, updatedAt: new Date() })
      .where(
        and(eq(person.emailStatus, PROBABLE_EMAIL_STATUS), eq(person.emailSource, HUBSPOT_IMPORT_EMAIL_SOURCE)),
      )
      .returning({ id: person.id });

    const updatedPersonIds = updated.map((r) => r.id);

    if (updatedPersonIds.length) {
      const historyRows = updatedPersonIds.map((id) => ({
        personId: id,
        property: "emailStatus",
        oldValue: PROBABLE_EMAIL_STATUS,
        newValue: VERIFIED_EMAIL_STATUS,
        changedByBdId: null,
        source: "migration" as const,
      }));
      for (let i = 0; i < historyRows.length; i += HISTORY_INSERT_BATCH_SIZE) {
        await tx.insert(personPropertyHistory).values(historyRows.slice(i, i + HISTORY_INSERT_BATCH_SIZE));
      }

      const metadata = buildHubspotEmailVerifiedBackfillAuditMetadata({ updatedPersonIds });
      await tx.insert(auditLog).values({
        actorBdId,
        action: "hubspot_email_verified_backfill",
        metadata,
      });
    }

    return { updatedPersonIds };
  });
}
