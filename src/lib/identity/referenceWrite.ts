/**
 * Pure identity-lookup helper for the write-cutover's "reference writes"
 * (design.md write-cutover addendum, "Reference writes"; contact-identity
 * spec "New activity carries the Contact"). `activity`/`task`/`signal`
 * inserts set `person_id` via a `person_id_map` lookup keyed on whichever
 * legacy subject the row carries — never via the matcher or the advisory
 * lock (task 4B.5/4B.6 never create a person).
 */
export interface ReferenceSubject {
  contactId?: string | null;
  leadId?: string | null;
  companyKey?: string | null;
}

export interface PersonIdLookup {
  legacyTable: "contact" | "lead";
  legacyId: string;
}

/**
 * A reference row (activity/task/signal) has exactly one subject, enforced
 * at the application level. `contactId` takes precedence when a row somehow
 * carries both legacy ids (shouldn't happen in practice). `companyKey`-only
 * rows, and rows with neither id, have no legacy row to map — `person_id`
 * stays null; there is nothing to look up.
 */
export function resolvePersonIdLookup(subject: ReferenceSubject): PersonIdLookup | null {
  if (subject.contactId) return { legacyTable: "contact", legacyId: subject.contactId };
  if (subject.leadId) return { legacyTable: "lead", legacyId: subject.leadId };
  return null;
}
