"use server";

/**
 * "Nuevo contacto" (mockups/contacts.html `#new-contact`). Owner decision:
 * "build it as the mockup shows, going through the identity resolver. If
 * it matches an existing person, show that match instead of creating a
 * duplicate."
 *
 * Thin DB wiring only — all real logic (matchIdentity precedence, the
 * decision table, and critically the lock ordering) lives in the pure,
 * port-injected `runCreateContactFlow`
 * (@/lib/contacts/createContactFlow, unit-tested without a database).
 *
 * Fresh-review fix: prefetch (byProfile/byCompany/byEmail) and the
 * `person` insert used to run outside any transaction or lock — two
 * concurrent "Nuevo contacto" submissions for the same email/profileKey/
 * company+name could both prefetch "no match" and both insert, producing
 * a duplicate person. Every other identity-writing path
 * (src/lib/queries.ts, src/lib/leads/queries.ts,
 * src/lib/hubspot/importQueries.ts) takes `withIdentityLock` around
 * prefetch+match+write — this now does the same: one `db.transaction`
 * whose `tx` backs every read/write port below, wrapped in
 * `withIdentityLock` inside `runCreateContactFlow`. A unique index on
 * `email_normalized` is not an option: prod already has legitimate
 * shared/duplicate emails pending review.
 *
 * Three targeted, index-friendly reads build the same kind of small
 * `IdentityIndex` the bulk ingest planner's prefetch would (profile key
 * exact match; company-key-scoped rows filtered by normalized name in app
 * code, same convention as prefetchIdentityIndex in resolveDb.ts; email
 * exact match on `emailNormalized`) — never an unbounded scan. A manually
 * typed email is never "verified" (see createContact.ts), so the
 * verified-email lookup the matcher would also consult is never reachable
 * here and is skipped entirely. `matchableRowFromFields` tags the row
 * `source: "manual_create"`, so an exact email hit against a live,
 * non-merged person auto-matches (matcher's manual_create rule) — same
 * "already exists" UX as a profile_key hit — instead of the
 * hubspot_import-only "review" outcome.
 *
 * "Crear de todas formas" on a name+company match writes a real
 * `duplicateCandidate` row (same table/shape the admin Duplicates screen
 * already reads) so an admin reviews it later — matching the mockup's "un
 * administrador lo revisará" text — without needing `person_id_map`
 * bookkeeping, which only makes sense for legacy-migration rows.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { duplicateCandidate, person, personBdConnection } from "@/db/schema";
import { getCurrentBd } from "@/lib/queries";
import { withIdentityLock } from "@/lib/identity/resolveDb";
import { buildNewContactFields, type NewContactFormInput } from "@/lib/contacts/createContact";
import {
  runCreateContactFlow,
  type CreateContactFlowPorts,
  type CreateContactResult,
} from "@/lib/contacts/createContactFlow";
import { classifyPosition } from "@/lib/roleGroups";

export type { CreateContactResult } from "@/lib/contacts/createContactFlow";

export async function createContactAction(
  input: NewContactFormInput,
  confirmDuplicate: boolean,
): Promise<CreateContactResult> {
  const me = await getCurrentBd();
  const fields = buildNewContactFields(input);

  return db.transaction(async (tx) => {
    const ports: CreateContactFlowPorts = {
      withLock: (fn) => withIdentityLock(tx, fn),
      prefetch: async (fields) => {
        const emailNormalized = fields.email ? fields.email.trim().toLowerCase() : null;
        const [byProfile, byCompany, byEmail] = await Promise.all([
          fields.profileKey
            ? tx
                .select()
                .from(person)
                .where(and(eq(person.profileKey, fields.profileKey), isNull(person.mergedIntoId)))
            : Promise.resolve([]),
          fields.companyKey
            ? tx
                .select()
                .from(person)
                .where(and(eq(person.companyKey, fields.companyKey), isNull(person.mergedIntoId)))
            : Promise.resolve([]),
          emailNormalized
            ? tx
                .select()
                .from(person)
                .where(and(eq(person.emailNormalized, emailNormalized), isNull(person.mergedIntoId)))
            : Promise.resolve([]),
        ]);
        return { byProfile, byCompany, byEmail };
      },
      insertPerson: async (newId, fields) => {
        await tx.insert(person).values({
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
      },
      insertConnection: async (newId) => {
        await tx
          .insert(personBdConnection)
          .values({ personId: newId, bdId: me.id, connectedOn: new Date().toISOString().slice(0, 10) })
          .onConflictDoNothing();
      },
      insertDuplicateCandidate: async ({ personAId, personBId, reason, matchKey }) => {
        await tx
          .insert(duplicateCandidate)
          .values({ personAId, personBId, reason, matchKey })
          .onConflictDoNothing();
      },
    };

    return runCreateContactFlow(fields, confirmDuplicate, ports);
  });
}
