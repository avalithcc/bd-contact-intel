/**
 * WHERE condition for the "Tipo de contacto" list filter. Plain equality, so
 * NULL rows never match (and there is deliberately no "Sin tipo" variant:
 * ~99.5 % of contacts are untyped, so it would filter nothing). Schema-only
 * import, so it stays unit-testable without a live DATABASE_URL.
 */
import { eq, type SQL } from "drizzle-orm";
import { person } from "@/db/schema";
import type { ContactType } from "@/lib/contacts/contactType";

export function contactTypeFilterCondition(value: ContactType): SQL {
  return eq(person.contactType, value);
}
