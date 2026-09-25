/**
 * Wires the live-ingestion identity resolver (./resolve.ts, ./resolveDb.ts)
 * into the write cutover callers (task 4B.3; design.md D11/D14; contact-
 * identity spec "Live ingestion resolves identity at write time"). Holds two
 * kinds of pieces:
 *
 * - Pure legacy-row -> IdentityIngestRow mappers (contactRowsToIdentityRows,
 *   leadRowsToIdentityRows), unit-tested directly.
 * - `runIdentityCutoverChunk`, a pure orchestration function over INJECTED
 *   ports (lock/legacyWrite/prefetch/apply) so the ordering and kill-switch
 *   behavior are unit-testable with fakes, without a database. The real DB
 *   wiring (upsertContacts, importLeads) supplies ports bound to one shared
 *   `db.transaction` tx, so a thrown error from any port rolls back the
 *   whole chunk, legacy write included.
 */
import type { EmailStatus } from "@/lib/identity/matcher";
import { normalizeProfileKey } from "@/lib/csv";
import {
  planIdentityWrites,
  type IdentityIngestRow,
  type IdentityWritePlan,
  type PrefetchedIdentityIndex,
} from "@/lib/identity/resolve";

// --- Contacts (CSV upload) ---------------------------------------------------

/** Shape returned by upsertContacts's per-chunk `.returning()` (task 4B.3). */
export interface InsertedContactRow {
  id: string;
  bdId: string;
  profileKey: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
  position: string | null;
  industry: string | null;
  connectedOn: string | null;
  email: string | null;
  emailStatus: string;
  emailConfidence: number | null;
  emailSource: string | null;
}

/**
 * Re-normalizes `profileKey` (contact rows are already normalized at CSV
 * parse time — src/lib/csv.ts — but the resolver's callers must never
 * assume that of every future ingestion source, and normalizeProfileKey is
 * idempotent on an already-normalized key) so the resolver always sees the
 * same key shape the matcher/prefetch queries index on.
 */
export function contactRowsToIdentityRows(rows: readonly InsertedContactRow[]): IdentityIngestRow[] {
  return rows.map((r) => ({
    legacyTable: "contact",
    legacyId: r.id,
    bdId: r.bdId,
    profileKey: normalizeProfileKey(r.profileKey),
    connectedOn: r.connectedOn,
    firstName: r.firstName,
    lastName: r.lastName,
    company: r.company,
    companyKey: r.companyKey,
    jobTitle: r.position,
    industry: r.industry,
    email: r.email,
    emailStatus: r.emailStatus as EmailStatus,
    emailConfidence: r.emailConfidence,
    emailSource: r.emailSource,
  }));
}

// --- Leads (leads ingest) ----------------------------------------------------

/** Shape returned by importLeads's per-chunk `.returning()` (task 4B.3). */
export interface InsertedLeadRow {
  id: string;
  ownerBdId: string | null;
  firstName: string | null;
  lastName: string | null;
  companyDisplay: string | null;
  companyRaw: string | null;
  companyKey: string | null;
  jobTitle: string | null;
  industryGroup: string | null;
  industryRaw: string | null;
  email: string | null;
  emailStatus: string;
  emailConfidence: number | null;
  emailSource: string | null;
}

/**
 * Only leads with a resolved owner become identity rows here: `bdId` is
 * required for `person_bd_connection` (design D2), and an owner-less lead
 * has nothing to connect. Owner-less leads stay unmapped in `person_id_map`
 * for now; the catch-up planner (task 4B.7, not yet wired) re-points them
 * once `updateLeadOwner` assigns one — same anti-join input contact-
 * migration spec's catch-up scenarios already describe.
 */
export function leadRowsToIdentityRows(rows: readonly InsertedLeadRow[]): IdentityIngestRow[] {
  return rows
    .filter((r): r is InsertedLeadRow & { ownerBdId: string } => r.ownerBdId != null)
    .map((r) => ({
      legacyTable: "lead",
      legacyId: r.id,
      bdId: r.ownerBdId,
      profileKey: null,
      connectedOn: null,
      firstName: r.firstName,
      lastName: r.lastName,
      company: r.companyDisplay ?? r.companyRaw,
      companyKey: r.companyKey,
      jobTitle: r.jobTitle,
      industry: r.industryGroup ?? r.industryRaw,
      email: r.email,
      emailStatus: r.emailStatus as EmailStatus,
      emailConfidence: r.emailConfidence,
      emailSource: r.emailSource,
    }));
}

// --- Orchestration (design D11/D14) -----------------------------------------

export interface IdentityCutoverPorts<LegacyRow> {
  /**
   * Callers MUST take this in the SAME transaction as legacyWrite/prefetch/
   * apply — see resolveDb.ts#withIdentityLock's caller contract. The lock
   * itself only needs to wrap `prefetch`+`apply` (design D14); `legacyWrite`
   * runs before it, still inside the same transaction.
   */
  withLock: (fn: () => Promise<void>) => Promise<void>;
  legacyWrite: () => Promise<LegacyRow[]>;
  toIdentityRows: (rows: readonly LegacyRow[]) => IdentityIngestRow[];
  prefetch: (rows: readonly IdentityIngestRow[]) => Promise<PrefetchedIdentityIndex>;
  apply: (plan: IdentityWritePlan) => Promise<void>;
}

/**
 * One chunk of the write cutover (task 4B.3). When `IDENTITY_DUAL_WRITE` is
 * enabled: runs the legacy write FIRST, then — only if that chunk produced
 * identity rows — takes the advisory lock around prefetch, matcher and
 * identity writes ONLY, so two chunks racing to create the same person
 * serialize (design D14: "legacy upsert, THEN pg_advisory_xact_lock, then
 * prefetch/match/writes"). When disabled: runs ONLY `legacyWrite`,
 * byte-identical to pre-cutover behavior (design D11) — no lock, no identity
 * read or write. A thrown error from any port (including `legacyWrite`)
 * still rolls back the whole chunk, since callers run everything in one
 * shared transaction (see `IdentityCutoverPorts.withLock`'s caller contract).
 */
export async function runIdentityCutoverChunk<LegacyRow>(
  dualWriteEnabled: boolean,
  ports: IdentityCutoverPorts<LegacyRow>,
): Promise<LegacyRow[]> {
  if (!dualWriteEnabled) return ports.legacyWrite();

  const legacyRows = await ports.legacyWrite();
  const identityRows = ports.toIdentityRows(legacyRows);
  if (identityRows.length) {
    await ports.withLock(async () => {
      const index = await ports.prefetch(identityRows);
      const plan = planIdentityWrites(identityRows, index);
      await ports.apply(plan);
    });
  }
  return legacyRows;
}
