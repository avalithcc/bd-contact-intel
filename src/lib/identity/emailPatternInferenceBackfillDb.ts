/**
 * Thin DB layer for scripts/backfill-inferred-emails.ts. All real logic
 * lives in emailPatternInferenceBackfill.ts (pure, unit-tested); this file
 * only touches the database — importing `db` throws without DATABASE_URL,
 * same convention as src/lib/identity/nameFromEmailBackfillDb.ts.
 */
import { and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, company, person, personPropertyHistory } from "@/db/schema";
import type { InferenceCandidate, InferenceFillPlanItem } from "@/lib/identity/emailPatternInferenceBackfill";
import {
  buildEmailPatternInferenceBackfillAuditMetadata,
  EMAIL_PATTERN_INFERENCE_BACKFILL_ACTION,
  isEmailPatternInferenceBackfillAuditWorthRecording,
  PATTERN_INFERRED_EMAIL_SOURCE,
} from "@/lib/identity/emailPatternInferenceBackfillAudit";

// Owner decision measured 5,052 candidates with a resolvable domain out of
// 20,708 without an email at all; capped well above both so a future run
// (more nameless contacts, more churn) still can't turn into an unbounded
// read — see PERFORMANCE.md "LIMIT even when it is small today".
export const CANDIDATE_READ_CAP = 30000;
// Defensive cap on how many colleague-email rows one run's companies can
// contribute in total (bounds one very large company's contribution, same
// spirit as emailSuggestion.ts's per-company SAMPLE_CAP, but applied to the
// WHOLE batched read since this is a one-shot script, not a per-request
// page render).
export const COLLEAGUE_EMAIL_READ_CAP = 100000;
const HISTORY_INSERT_BATCH_SIZE = 500;
const CHUNK_SIZE = 2000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export interface CandidatePersonRow {
  personId: string;
  firstName: string | null;
  lastName: string | null;
  companyKey: string;
}

/**
 * Every non-merged person with no email at all and a company_key to resolve
 * a domain from — one indexed query (person_company_key_idx covers the
 * company_key filter; email IS NULL is a simple column check), capped,
 * never a per-row read. Ordered by id for a deterministic dry-run report.
 */
export async function readCandidates(): Promise<CandidatePersonRow[]> {
  const rows = await db
    .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, companyKey: person.companyKey })
    .from(person)
    .where(and(isNull(person.mergedIntoId), isNull(person.email), sql`${person.companyKey} is not null`))
    .orderBy(person.id)
    .limit(CANDIDATE_READ_CAP);

  return rows.map((r) => ({ personId: r.id, firstName: r.firstName, lastName: r.lastName, companyKey: r.companyKey! }));
}

/** `company.domain` for exactly the company keys appearing in this run's
 * candidates — scoped by the `company` table's primary key, never the whole
 * table. */
export async function readCompanyDomains(companyKeys: readonly string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (const keys of chunk(companyKeys, CHUNK_SIZE)) {
    if (keys.length === 0) continue;
    const rows = await db
      .select({ companyKey: company.companyKey, domain: company.domain })
      .from(company)
      .where(inArray(company.companyKey, keys));
    for (const row of rows) map.set(row.companyKey, row.domain);
  }
  return map;
}

export interface ColleagueEmailRow {
  companyKey: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

/**
 * Every non-merged person with a known email at one of this run's candidate
 * companies — scoped by `person_company_key_idx`, never the whole `person`
 * table (26,600+ rows). Feeds BOTH domain resolution (resolveCandidateDomain)
 * and pattern-detection evidence (detectDominantPattern) in the pure
 * planner, one read instead of two.
 */
export async function readColleagueEmails(companyKeys: readonly string[]): Promise<Map<string, ColleagueEmailRow[]>> {
  const byCompany = new Map<string, ColleagueEmailRow[]>();
  for (const keys of chunk(companyKeys, CHUNK_SIZE)) {
    if (keys.length === 0) continue;
    const rows = await db
      .select({
        companyKey: person.companyKey,
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
      })
      .from(person)
      .where(and(isNull(person.mergedIntoId), inArray(person.companyKey, keys), sql`${person.email} is not null`))
      .limit(COLLEAGUE_EMAIL_READ_CAP);
    for (const row of rows) {
      const list = byCompany.get(row.companyKey!) ?? [];
      list.push({ companyKey: row.companyKey!, firstName: row.firstName, lastName: row.lastName, email: row.email! });
      byCompany.set(row.companyKey!, list);
    }
  }
  return byCompany;
}

/** Joins the three reads above into the pure planner's input shape. */
export function buildInferenceCandidates(
  candidates: readonly CandidatePersonRow[],
  companyDomains: ReadonlyMap<string, string | null>,
  colleagueEmails: ReadonlyMap<string, ColleagueEmailRow[]>,
): InferenceCandidate[] {
  return candidates.map((c) => ({
    personId: c.personId,
    firstName: c.firstName,
    lastName: c.lastName,
    companyKey: c.companyKey,
    companyDomain: companyDomains.get(c.companyKey) ?? null,
    colleagueEmails: colleagueEmails.get(c.companyKey) ?? [],
  }));
}

/**
 * Every ALREADY-EXISTING non-merged person's `email_normalized` that matches
 * one of this run's planned fills — one indexed round trip via
 * `person_email_normalized_idx`, bounded by this run's own fill count, never
 * the whole table. Feeds emailPatternInferenceBackfill.ts#filterExistingCollisions.
 */
export async function readExistingEmailNormalized(candidateEmailsNormalized: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const emails of chunk(candidateEmailsNormalized, CHUNK_SIZE)) {
    if (emails.length === 0) continue;
    const rows = await db
      .select({ emailNormalized: person.emailNormalized })
      .from(person)
      .where(and(isNull(person.mergedIntoId), inArray(person.emailNormalized, emails)));
    for (const row of rows) if (row.emailNormalized) found.add(row.emailNormalized);
  }
  return found;
}

export interface EmailPatternInferenceBackfillResult {
  appliedPersonIds: string[];
  skippedRacePersonIds: string[];
}

/**
 * Executes the write in one transaction: a single batched
 * `UPDATE ... FROM (VALUES ...)` (never one round trip per row), re-checking
 * `email IS NULL` at write time (a row filled by something else since the
 * dry run is skipped, not overwritten, and reported as `skippedRacePersonIds`),
 * a batched `person_property_history` insert (email/emailNormalized/
 * emailStatus/emailSource — same 4-row-per-change shape
 * src/lib/hubspot/refill.ts uses for a system-driven email fill, `source:
 * "migration"` — same precedent as
 * src/lib/emailVerification/hubspotImportVerifiedQueries.ts), and ONE
 * `audit_log` row, only when at least one fill was applied.
 */
export async function executeEmailPatternInferenceBackfill(
  fills: readonly InferenceFillPlanItem[],
  actorBdId: string,
): Promise<EmailPatternInferenceBackfillResult> {
  return db.transaction(async (tx) => {
    const appliedPersonIds: string[] = [];
    const skippedRacePersonIds: string[] = [];

    for (const batch of chunk(fills, CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      const values = batch.map(
        (fill) => sql`(${fill.personId}::uuid, ${fill.email}::text, ${fill.emailNormalized}::text)`,
      );
      const updatedRows = (await tx.execute(sql`
        UPDATE person AS p
        SET email = v.email,
            email_normalized = v.email_normalized,
            email_status = 'probable',
            email_source = ${PATTERN_INFERRED_EMAIL_SOURCE},
            updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, email, email_normalized)
        WHERE p.id = v.id
          AND p.email IS NULL
        RETURNING p.id
      `)) as unknown as { id: string }[];

      const updatedIds = new Set(updatedRows.map((r) => r.id));
      for (const fill of batch) {
        if (updatedIds.has(fill.personId)) appliedPersonIds.push(fill.personId);
        else skippedRacePersonIds.push(fill.personId);
      }
    }

    if (appliedPersonIds.length > 0) {
      const appliedFillsByPersonId = new Map(fills.map((f) => [f.personId, f] as const));
      const historyRows = appliedPersonIds.flatMap((personId) => {
        const fill = appliedFillsByPersonId.get(personId)!;
        return [
          { personId, property: "email", oldValue: null, newValue: fill.email, changedByBdId: null, source: "migration" as const },
          { personId, property: "emailNormalized", oldValue: null, newValue: fill.emailNormalized, changedByBdId: null, source: "migration" as const },
          { personId, property: "emailStatus", oldValue: "none", newValue: "probable", changedByBdId: null, source: "migration" as const },
          { personId, property: "emailSource", oldValue: null, newValue: PATTERN_INFERRED_EMAIL_SOURCE, changedByBdId: null, source: "migration" as const },
        ];
      });
      for (const rows of chunk(historyRows, HISTORY_INSERT_BATCH_SIZE)) {
        await tx.insert(personPropertyHistory).values(rows);
      }
    }

    if (isEmailPatternInferenceBackfillAuditWorthRecording({ appliedPersonIds })) {
      const metadata = buildEmailPatternInferenceBackfillAuditMetadata({
        fillsPlanned: fills.length,
        appliedPersonIds,
        skippedRacePersonIds,
      });
      await tx.insert(auditLog).values({
        actorBdId,
        action: EMAIL_PATTERN_INFERENCE_BACKFILL_ACTION,
        metadata,
      });
    }

    return { appliedPersonIds, skippedRacePersonIds };
  });
}
