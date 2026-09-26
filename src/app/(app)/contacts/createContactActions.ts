"use server";

/**
 * "Nuevo contacto" (mockups/contacts.html `#new-contact`). Owner decision:
 * "build it as the mockup shows, going through the identity resolver. If
 * it matches an existing person, show that match instead of creating a
 * duplicate."
 *
 * Reuses `matchIdentity` — the SAME matcher/precedence every ingestion path
 * uses (@/lib/identity/matcher) — instead of the bulk ingest planner in
 * @/lib/identity/resolve.ts. That planner's `IdentityIngestRow` requires a
 * real `legacyTable`/`legacyId` from the old `contact`/`lead` schema being
 * migrated; a manually-typed new contact has no such row, so forcing one
 * through would mean inventing a fake legacy reference just to satisfy the
 * pipeline's shape. Two targeted, index-friendly reads build the same kind
 * of small `IdentityIndex` the planner's prefetch would (profile key exact
 * match; company-key-scoped rows filtered by normalized name in app code,
 * same convention as prefetchIdentityIndex in resolveDb.ts) — never an
 * unbounded scan. A manually typed email is never "verified" (see
 * createContact.ts), so the verified-email lookup the matcher would also
 * consult is never reachable here and is skipped entirely.
 *
 * "Crear de todas formas" on a name+company match writes a real
 * `duplicateCandidate` row (same table/shape the admin Duplicates screen
 * already reads) so an admin reviews it later — matching the mockup's "un
 * administrador lo revisará" text — without needing `person_id_map`
 * bookkeeping, which only makes sense for legacy-migration rows.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { duplicateCandidate, person, personBdConnection } from "@/db/schema";
import { getCurrentBd } from "@/lib/queries";
import { matchIdentity, buildNameCompanyKey } from "@/lib/identity/matcher";
import {
  buildNewContactFields,
  classifyMatchResultForCreate,
  matchableRowFromFields,
  type NewContactFormInput,
} from "@/lib/contacts/createContact";
import { classifyPosition } from "@/lib/roleGroups";

export interface CreateContactResult {
  action: "created" | "existing_match" | "needs_confirmation" | "blocked_own_company" | "invalid";
  personId?: string;
  existingPersonId?: string;
  existingName?: string;
}

function personName(row: { firstName: string | null; lastName: string | null }): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || "—";
}

export async function createContactAction(
  input: NewContactFormInput,
  confirmDuplicate: boolean,
): Promise<CreateContactResult> {
  const me = await getCurrentBd();
  const fields = buildNewContactFields(input);
  if (!fields.firstName && !fields.lastName) return { action: "invalid" };

  const matchRow = matchableRowFromFields(fields);

  // Two targeted, indexed reads — never an unbounded scan (NO DB access
  // rule: bounded by profileKey uniqueness / companyKey index).
  const byProfile = fields.profileKey
    ? await db
        .select()
        .from(person)
        .where(and(eq(person.profileKey, fields.profileKey), isNull(person.mergedIntoId)))
    : [];
  const byCompany = fields.companyKey
    ? await db
        .select()
        .from(person)
        .where(and(eq(person.companyKey, fields.companyKey), isNull(person.mergedIntoId)))
    : [];

  const byId = new Map<string, typeof person.$inferSelect>();
  for (const row of [...byProfile, ...byCompany]) byId.set(row.id, row);

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
    // Never reached: matchIdentity only consults this when row.source is
    // "hubspot_import" (contact-identity delta's email_unverified review
    // rule), and matchRow here never sets that — this is a manually typed
    // contact, not a HubSpot import row.
    byEmail: () => [],
    byNameCompany: (key) => byNameCompanyIds.get(key) ?? [],
  });

  const decision = classifyMatchResultForCreate(result);

  if (decision.action === "existing_match") {
    const existing = byId.get(decision.existingPersonId);
    return { action: "existing_match", existingPersonId: decision.existingPersonId, existingName: existing ? personName(existing) : undefined };
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
  await db.insert(person).values({
    id: newId,
    profileKey: fields.profileKey,
    firstName: fields.firstName,
    lastName: fields.lastName,
    email: fields.email,
    emailNormalized: fields.email ? fields.email.trim().toLowerCase() : null,
    emailStatus: fields.emailStatus,
    company: fields.company,
    companyKey: fields.companyKey,
    roleGroup: classifyPosition(null),
    ownerBdId: me.id,
    sourceKey: "manual",
  });
  await db
    .insert(personBdConnection)
    .values({ personId: newId, bdId: me.id, connectedOn: new Date().toISOString().slice(0, 10) })
    .onConflictDoNothing();

  if (decision.action === "needs_confirmation" && confirmDuplicate) {
    const [personAId, personBId] = newId < decision.existingPersonId ? [newId, decision.existingPersonId] : [decision.existingPersonId, newId];
    await db
      .insert(duplicateCandidate)
      .values({
        personAId,
        personBId,
        reason: decision.reason,
        matchKey: buildNameCompanyKey(matchRow) ?? "",
      })
      .onConflictDoNothing();
  }

  return { action: "created", personId: newId };
}
