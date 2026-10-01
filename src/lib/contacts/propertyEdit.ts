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
import { isContactType } from "@/lib/contacts/contactType";
import { splitEmail } from "@/lib/emailPatterns";
import { isValidPhoneFormat } from "@/lib/phone";

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

export type InvalidPhoneReason = "invalid_format";

/**
 * Thrown by planPropertyEdit before building any plan (migration 0016):
 * mirrors InvalidEmailError above for `phone`/`mobilePhone` — a value that
 * doesn't look like a phone number (src/lib/phone.ts#isValidPhoneFormat)
 * never reaches the DB. Not thrown when the new value is blank (clearing
 * the property is always allowed).
 */
export class InvalidPhoneError extends Error {
  constructor(public readonly reason: InvalidPhoneReason) {
    super(`Invalid phone: ${reason}`);
    this.name = "InvalidPhoneError";
  }
}

/**
 * Thrown by planPropertyEdit when `contactType` is set to something outside
 * the closed vocabulary (contactType.ts). Clearing (blank) is always allowed.
 */
export class InvalidContactTypeError extends Error {
  constructor() {
    super("Invalid contact type: not in the vocabulary");
    this.name = "InvalidContactTypeError";
  }
}

/** Same "local@domain-with-a-dot" bar as splitEmail, plus a literal dot in the domain. */
function isValidEmailFormat(value: string): boolean {
  const split = splitEmail(value);
  return split !== null && split.domain.includes(".");
}

export const EDITABLE_PERSON_PROPERTIES = [
  "email",
  "phone",
  "mobilePhone",
  "jobTitle",
  "roleGroup",
  "contactType",
  "seniority",
  "city",
  "region",
  "country",
  "industry",
] as const;

const PHONE_PROPERTIES = new Set(["phone", "mobilePhone"]);

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

  if (PHONE_PROPERTIES.has(property) && newValue !== null && !isValidPhoneFormat(newValue)) {
    throw new InvalidPhoneError("invalid_format");
  }

  if (property === "contactType" && newValue !== null && !isContactType(newValue)) {
    throw new InvalidContactTypeError();
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

/** The three fields the "Ubicación" composite row (contact-record.html:86)
 * edits together — see `planLocationEdit` below. */
export type LocationProperty = "city" | "region" | "country";

export interface LocationEditFields {
  city: string;
  region: string;
  country: string;
}

export interface PropertyBatchEditPlan {
  changed: boolean;
  personUpdate: Partial<NewPerson> | null;
  historyRows: HistoryRow[];
}

/**
 * Thrown by `planPropertyEditBatch` (and, through it, `planLocationEdit`)
 * before any field's plan is merged (fresh-review CRITICAL fix —
 * PropertyList.tsx's `LocationPropertyRow` used to call
 * `updateContactPropertyAction` three times sequentially, so a rejected
 * second/third field left the first already persisted). Names WHICH field
 * failed and preserves the original per-field error as `cause` (an
 * `InvalidEmailError`/`InvalidPhoneError` today) so the UI can report
 * "which field, and why".
 */
export class PropertyBatchEditError extends Error {
  constructor(
    public readonly property: EditablePersonProperty,
    public readonly cause: unknown,
  ) {
    super(`Batch edit rejected at property: ${property}`);
    this.name = "PropertyBatchEditError";
  }
}

/**
 * Plans an arbitrary set of properties as ONE atomic edit. Reuses
 * `planPropertyEdit`'s per-field validation and old/new-value diffing
 * unchanged (so a no-op field never gets a history row, and a changed field
 * still gets exactly its own history rows, exactly as the single-property
 * path does), but only MERGES the per-field plans into one combined plan
 * instead of applying each one as it's produced. If any entry fails
 * validation, this throws `PropertyBatchEditError` before merging that
 * entry (or any entry after it) into the combined plan — entries already
 * merged are only ever returned to the caller inside the SAME successful
 * return value, never written or exposed on a throw, so the DB glue
 * (`updateContactProperties`) either gets one fully-merged plan to write in
 * one transaction, or an exception and nothing to write at all.
 *
 * Pure: never mutates `person` or `entries` (rule: pure planners never
 * mutate their inputs) — every value read is only read, never assigned
 * back into; calling this twice with the same `person`/`entries` produces
 * the same `personUpdate`/`historyRows` (module clock aside).
 */
export function planPropertyEditBatch(
  person: EditablePersonForPlan,
  entries: Array<{ property: EditablePersonProperty; rawNewValue: string }>,
  changedByBdId: string,
): PropertyBatchEditPlan {
  const personUpdate: Partial<NewPerson> = {};
  const historyRows: HistoryRow[] = [];
  let changed = false;

  for (const { property, rawNewValue } of entries) {
    let fieldPlan: PropertyEditPlan;
    try {
      fieldPlan = planPropertyEdit(person, property, rawNewValue, changedByBdId);
    } catch (cause) {
      throw new PropertyBatchEditError(property, cause);
    }
    if (!fieldPlan.changed) continue;
    changed = true;
    Object.assign(personUpdate, fieldPlan.personUpdate);
    historyRows.push(...fieldPlan.historyRows);
  }

  if (!changed) return { changed: false, personUpdate: null, historyRows: [] };

  return {
    changed: true,
    personUpdate: { ...personUpdate, updatedAt: new Date(), updatedByBdId: changedByBdId },
    historyRows,
  };
}

/**
 * Plans all three "Ubicación" fields (contact-record.html:86) as one
 * atomic edit — a thin, fixed-field wrapper over `planPropertyEditBatch`
 * (see its doc comment for the atomicity guarantee).
 */
export function planLocationEdit(
  person: EditablePersonForPlan,
  fields: LocationEditFields,
  changedByBdId: string,
): PropertyBatchEditPlan {
  return planPropertyEditBatch(
    person,
    [
      { property: "city", rawNewValue: fields.city },
      { property: "region", rawNewValue: fields.region },
      { property: "country", rawNewValue: fields.country },
    ],
    changedByBdId,
  );
}
