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
import { splitEmail } from "@/lib/emailPatterns";

export type InvalidEmailReason = "invalid_format";

/**
 * Thrown by planPropertyEdit before building any plan (fresh-review CRITICAL
 * fix): an edited `email` value that doesn't look like an email must never
 * reach the DB, since emailNormalized feeds the verified-email identity
 * matcher (src/lib/identity/matcher.ts, resolveDb.ts).
 */
export class InvalidEmailError extends Error {
  constructor(public readonly reason: InvalidEmailReason) {
    super(`Invalid email: ${reason}`);
    this.name = "InvalidEmailError";
  }
}

/** Same "local@domain-with-a-dot" bar as splitEmail, plus a literal dot in the domain. */
function isValidEmailFormat(value: string): boolean {
  const split = splitEmail(value);
  return split !== null && split.domain.includes(".");
}

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

type HistoryRow = Omit<NewPersonPropertyHistory, "id" | "at">;

export interface PropertyEditPlan {
  changed: boolean;
  personUpdate: Partial<NewPerson> | null;
  historyRows: HistoryRow[];
}

export type EditablePersonForPlan = Pick<
  Person,
  "id" | EditablePersonProperty | "emailNormalized" | "emailStatus" | "emailSource"
>;

function historyRow(
  personId: string,
  property: string,
  oldValue: string | null,
  newValue: string | null,
  changedByBdId: string,
): HistoryRow | null {
  if (oldValue === newValue) return null;
  return { personId, property, oldValue, newValue, changedByBdId, source: "edit" };
}

/**
 * `rawNewValue` is trimmed; an all-blank value clears the property to
 * `null` (matches the DB's nullable text columns). A no-op edit (trimmed new
 * value equals the current value, including null == null) reports
 * `changed: false` so the caller never writes an empty history row.
 *
 * `email` is special-cased (fresh-review CRITICAL fix, contact-identity R7):
 * an edited email must also keep `emailNormalized` (lowercased/trimmed, used
 * by the verified-email identity matcher — resolveDb.ts) in sync, and is
 * reset to a manual, unverified state since a human typed it rather than an
 * ingestion source confirming it. `EmailStatus` has no "manual" value
 * (src/lib/identity/matcher.ts: "verified" | "probable" | "none"), so
 * `emailStatus` is set to `"none"` (the closest existing "not verified"
 * meaning) and `emailSource` to the literal `"manual"` (a free-text column,
 * so this doesn't collide with any ingestion source name). Every changed
 * column gets its own history row.
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
    return { changed: false, personUpdate: null, historyRows: [] };
  }

  if (property === "email" && newValue !== null && !isValidEmailFormat(newValue)) {
    throw new InvalidEmailError("invalid_format");
  }

  const personUpdate: Partial<NewPerson> = {
    [property]: newValue,
    updatedAt: new Date(),
    updatedByBdId: changedByBdId,
  };
  const rows = [historyRow(person.id, property, oldValue, newValue, changedByBdId)];

  if (property === "email") {
    const newNormalized = newValue === null ? null : newValue.toLowerCase();
    const newStatus = "none";
    const newSource = newValue === null ? null : "manual";
    personUpdate.emailNormalized = newNormalized;
    personUpdate.emailStatus = newStatus;
    personUpdate.emailSource = newSource;
    rows.push(
      historyRow(person.id, "emailNormalized", person.emailNormalized ?? null, newNormalized, changedByBdId),
      historyRow(person.id, "emailStatus", person.emailStatus ?? null, newStatus, changedByBdId),
      historyRow(person.id, "emailSource", person.emailSource ?? null, newSource, changedByBdId),
    );
  }

  return {
    changed: true,
    personUpdate,
    historyRows: rows.filter((r): r is HistoryRow => r !== null),
  };
}
