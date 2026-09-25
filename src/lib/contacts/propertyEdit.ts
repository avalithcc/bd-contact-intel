/**
 * Pure planner for a single-property inline edit on the Contact record page
 * (contact-record spec "editable properties"; contact-identity R7: "The
 * system MUST keep one current value per property with change history
 * recording who last updated it"). No I/O — the thin DB glue
 * (propertyEditDb.ts) reads the current `person` row, calls this, and writes
 * the person update plus the history row in one transaction so they never
 * diverge.
 *
 * Deliberately scoped to plain scalar columns: `ownerBdId` (Responsable in
 * the mockup) is excluded — reassigning the owner has its own business rule
 * (design R3: "owner set only when the person has no person_bd_connection
 * yet") that a generic property editor would bypass. `status` is excluded
 * per design D4 (a derived cache, never edited directly). Owner reassignment
 * is left as a documented gap for a later phase.
 */
import type { NewPerson, NewPersonPropertyHistory, Person } from "@/db/schema";

export const EDITABLE_PERSON_PROPERTIES = [
  "email",
  "jobTitle",
  "roleGroup",
  "seniority",
  "city",
  "region",
  "country",
  "industry",
] as const;

export type EditablePersonProperty = (typeof EDITABLE_PERSON_PROPERTIES)[number];

export function isEditablePersonProperty(value: string): value is EditablePersonProperty {
  return (EDITABLE_PERSON_PROPERTIES as readonly string[]).includes(value);
}

export interface PropertyEditPlan {
  changed: boolean;
  personUpdate: Partial<NewPerson> | null;
  historyRow: Omit<NewPersonPropertyHistory, "id" | "at"> | null;
}

export type EditablePersonForPlan = Pick<Person, "id" | EditablePersonProperty>;

/**
 * `rawNewValue` is trimmed; an all-blank value clears the property to
 * `null` (matches the DB's nullable text columns). A no-op edit (trimmed new
 * value equals the current value, including null == null) reports
 * `changed: false` so the caller never writes an empty history row.
 */
export function planPropertyEdit(
  person: EditablePersonForPlan,
  property: EditablePersonProperty,
  rawNewValue: string,
  changedByBdId: string,
): PropertyEditPlan {
  const trimmed = rawNewValue.trim();
  const newValue = trimmed === "" ? null : trimmed;
  const oldValue = person[property] ?? null;

  if (oldValue === newValue) {
    return { changed: false, personUpdate: null, historyRow: null };
  }

  return {
    changed: true,
    personUpdate: {
      [property]: newValue,
      updatedAt: new Date(),
      updatedByBdId: changedByBdId,
    } as Partial<NewPerson>,
    historyRow: {
      personId: person.id,
      property,
      oldValue,
      newValue,
      changedByBdId,
      source: "edit",
    },
  };
}
