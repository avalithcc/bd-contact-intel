/**
 * Pure orchestration for "Nuevo contacto" (mockups/contacts.html
 * `#new-contact`) — port-injected (withLock/prefetch/insert*) so the ORDER
 * (the lock wraps prefetch + match + every insert) is unit-testable with
 * fakes, without a database — same split convention as
 * src/lib/identity/ingestWrite.ts#runIdentityCutoverChunk (tested in
 * tests/unit/identityIngestWrite.test.ts via a `calls` recorder).
 *
 * Fresh-review fix: createContactActions.ts used to read
 * byProfile/byCompany/byEmail and then insert `person` OUTSIDE any
 * transaction or lock — every OTHER identity-writing path
 * (src/lib/queries.ts, src/lib/leads/queries.ts,
 * src/lib/hubspot/importQueries.ts) takes `withIdentityLock` around
 * prefetch+match+write precisely because two concurrent callers can both
 * prefetch "no match" for the same email/profileKey and both insert —
 * this path had the exact same race. A unique index on `email_normalized`
 * is not an option: prod already has legitimate shared/duplicate emails
 * pending review. createContactActions.ts supplies the real ports, all
 * bound to one shared `db.transaction` tx, wrapped in `withIdentityLock`.
 */
import { randomUUID } from "node:crypto";
import { matchIdentity, buildNameCompanyKey, type ReviewReason } from "@/lib/identity/matcher";
import {
  classifyMatchResultForCreate,
  matchableRowFromFields,
  type NewContactFields,
} from "@/lib/contacts/createContact";

/** Subset of `person` columns the matcher/duplicate-check needs — same fields prefetchIdentityIndex's ExistingPersonCandidate carries for this purpose. */
export interface ExistingPersonRow {
  id: string;
  profileKey: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
  emailNormalized: string | null;
}

export interface CreateContactPrefetch {
  byProfile: ExistingPersonRow[];
  byCompany: ExistingPersonRow[];
  byEmail: ExistingPersonRow[];
}

export interface CreateContactResult {
  action: "created" | "existing_match" | "needs_confirmation" | "blocked_own_company" | "invalid";
  personId?: string;
  existingPersonId?: string;
  existingName?: string;
}

export interface InsertDuplicateCandidateInput {
  personAId: string;
  personBId: string;
  reason: ReviewReason;
  matchKey: string;
}

export interface CreateContactFlowPorts {
  /** MUST take the same advisory lock every other identity writer takes, wrapping prefetch + match + every insert below (fresh-review fix). */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  prefetch(fields: NewContactFields): Promise<CreateContactPrefetch>;
  insertPerson(newId: string, fields: NewContactFields): Promise<void>;
  insertConnection(newId: string): Promise<void>;
  insertDuplicateCandidate(input: InsertDuplicateCandidateInput): Promise<void>;
}

function personName(row: { firstName: string | null; lastName: string | null }): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || "—";
}

export async function runCreateContactFlow(
  fields: NewContactFields,
  confirmDuplicate: boolean,
  ports: CreateContactFlowPorts,
): Promise<CreateContactResult> {
  if (!fields.firstName && !fields.lastName) return { action: "invalid" };

  const matchRow = matchableRowFromFields(fields);

  return ports.withLock(async () => {
    const { byProfile, byCompany, byEmail } = await ports.prefetch(fields);

    const byId = new Map<string, ExistingPersonRow>();
    for (const row of [...byProfile, ...byCompany, ...byEmail]) byId.set(row.id, row);

    const byNameCompanyIds = new Map<string, string[]>();
    for (const row of byId.values()) {
      const key = buildNameCompanyKey({ firstName: row.firstName, lastName: row.lastName, company: row.company });
      if (key) byNameCompanyIds.set(key, [...(byNameCompanyIds.get(key) ?? []), row.id]);
    }

    const result = matchIdentity(matchRow, {
      byProfileKey: (key) => byProfile.find((r) => r.profileKey === key)?.id ?? null,
      // Never reached: matchIdentity only consults this when the incoming
      // row's emailStatus is "verified", and buildNewContactFields never
      // produces that for a manually typed address (see its doc comment).
      byVerifiedEmail: () => null,
      // Backs the matcher's manual_create exact-email rule (matchRow's
      // `source: "manual_create"`, set by matchableRowFromFields).
      byEmail: (email) => byEmail.filter((r) => r.emailNormalized === email).map((r) => r.id),
      byNameCompany: (key) => byNameCompanyIds.get(key) ?? [],
    });

    const decision = classifyMatchResultForCreate(result);

    if (decision.action === "existing_match") {
      const existing = byId.get(decision.existingPersonId);
      return {
        action: "existing_match",
        existingPersonId: decision.existingPersonId,
        existingName: existing ? personName(existing) : undefined,
      };
    }
    if (decision.action === "blocked_own_company") return { action: "blocked_own_company" };
    if (decision.action === "needs_confirmation" && !confirmDuplicate) {
      const existing = byId.get(decision.existingPersonId);
      return {
        action: "needs_confirmation",
        existingPersonId: decision.existingPersonId,
        existingName: existing ? personName(existing) : undefined,
      };
    }

    // decision.action === "create", or "needs_confirmation" with
    // confirmDuplicate === true (mockup: "Crear de todas formas").
    const newId = randomUUID();
    await ports.insertPerson(newId, fields);
    await ports.insertConnection(newId);

    if (decision.action === "needs_confirmation" && confirmDuplicate) {
      const [personAId, personBId] =
        newId < decision.existingPersonId ? [newId, decision.existingPersonId] : [decision.existingPersonId, newId];
      await ports.insertDuplicateCandidate({
        personAId,
        personBId,
        reason: decision.reason,
        matchKey: buildNameCompanyKey(matchRow) ?? "",
      });
    }

    return { action: "created", personId: newId };
  });
}
