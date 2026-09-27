/**
 * Pure planner for a single-property inline edit on the Company record page
 * (company-fields change, owner-approved 2026-09-26). Mirrors
 * src/lib/contacts/propertyEdit.ts: no I/O — the thin DB glue
 * (propertyEditDb.ts) reads the current `company` row, calls this, and
 * writes the company update plus the company_property_history row in one
 * transaction so they never diverge.
 *
 * `ownerBdId` is a real BD id, not free text, so it cannot be validated
 * inside this pure planner (no DB access here). The DB writer checks
 * whether the incoming id is a real `bd` row and passes the result in via
 * `context.ownerExists` — clearing the owner (blank value) never needs that
 * check, since null is always a valid "no owner" state.
 */
import type { Company, NewCompany, NewCompanyPropertyHistory } from "@/db/schema";

export const EDITABLE_COMPANY_PROPERTIES = ["industry", "ownerBdId", "city", "country"] as const;

export type EditableCompanyProperty = (typeof EDITABLE_COMPANY_PROPERTIES)[number];

export function isEditableCompanyProperty(value: string): value is EditableCompanyProperty {
  return (EDITABLE_COMPANY_PROPERTIES as readonly string[]).includes(value);
}

export type InvalidOwnerReason = "unknown_bd";

/**
 * Thrown by planCompanyPropertyEdit before building any plan: an owner id
 * that doesn't match a real `bd` row must never reach the DB.
 */
export class InvalidOwnerError extends Error {
  constructor(public readonly reason: InvalidOwnerReason) {
    super(`Invalid owner: ${reason}`);
    this.name = "InvalidOwnerError";
  }
}

type HistoryRow = Omit<NewCompanyPropertyHistory, "id" | "at">;

export interface PlanCompanyPropertyEditContext {
  /** Whether the incoming `ownerBdId` value matches a real `bd.id` — only
   * consulted when `property === "ownerBdId"` and the new value is
   * non-null (clearing the owner never needs this check). */
  ownerExists?: boolean;
}

export interface CompanyPropertyEditPlan {
  changed: boolean;
  companyUpdate: Partial<NewCompany> | null;
  historyRows: HistoryRow[];
}

export type EditableCompanyForPlan = Pick<Company, "companyKey" | EditableCompanyProperty>;

function historyRow(
  companyKey: string,
  property: string,
  oldValue: string | null,
  newValue: string | null,
  changedByBdId: string,
): HistoryRow | null {
  if (oldValue === newValue) return null;
  return { companyKey, property, oldValue, newValue, changedByBdId, source: "edit" };
}

/**
 * `rawNewValue` is trimmed; an all-blank value clears the property to
 * `null`. A no-op edit (trimmed new value equals the current value,
 * including null == null) reports `changed: false` so the caller never
 * writes an empty history row.
 */
export function planCompanyPropertyEdit(
  companyRow: EditableCompanyForPlan,
  property: EditableCompanyProperty,
  rawNewValue: string,
  changedByBdId: string,
  context: PlanCompanyPropertyEditContext = {},
): CompanyPropertyEditPlan {
  const trimmed = rawNewValue.trim();
  const newValue = trimmed === "" ? null : trimmed;
  const oldValue = companyRow[property] ?? null;

  if (oldValue === newValue) {
    return { changed: false, companyUpdate: null, historyRows: [] };
  }

  if (property === "ownerBdId" && newValue !== null && !context.ownerExists) {
    throw new InvalidOwnerError("unknown_bd");
  }

  const companyUpdate: Partial<NewCompany> = {
    [property]: newValue,
    updatedAt: new Date(),
    updatedByBdId: changedByBdId,
  };
  const rows = [historyRow(companyRow.companyKey, property, oldValue, newValue, changedByBdId)];

  return {
    changed: true,
    companyUpdate,
    historyRows: rows.filter((r): r is HistoryRow => r !== null),
  };
}
