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
import { isClientStatus } from "@/lib/companies/clientStatus";
import { InvalidCompanyDomainError, normalizeCompanyDomain } from "@/lib/companies/domain";
import { InvalidCompanyLinkedinUrlError, normalizeCompanyLinkedinUrl } from "@/lib/companies/linkedinUrl";

export const EDITABLE_COMPANY_PROPERTIES = ["industry", "ownerBdId", "city", "country", "clientStatus", "linkedinUrl", "domain"] as const;

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

/**
 * Thrown by planCompanyPropertyEdit before building any plan: a client
 * status outside the `active | inactive` vocabulary must never reach the DB
 * (the column has no CHECK, so this is the only guard).
 */
export class InvalidClientStatusError extends Error {
  constructor(public readonly value: string) {
    super(`Invalid client status: ${value}`);
    this.name = "InvalidClientStatusError";
  }
}

/**
 * Thrown by the DB glue (never the pure planner, which cannot see other
 * rows) when another company already holds the domain: `company_domain_idx`
 * is a partial unique index, so the write would otherwise fail with a raw
 * constraint error the BD cannot act on.
 */
export class DomainInUseError extends Error {
  constructor(public readonly domain: string) {
    super(`Domain already in use: ${domain}`);
    this.name = "DomainInUseError";
  }
}

/** True for the Postgres unique violation on `company_domain_idx`, whether
 * the driver error is raw or wrapped (drizzle keeps it on `cause`). */
export function isDomainIndexViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const { code, constraint_name: constraint, constraint: alt } = e as { code?: string; constraint_name?: string; constraint?: string };
    if (code === "23505" && (constraint ?? alt) === "company_domain_idx") return true;
  }
  return false;
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

// Only the key is required; the planner reads just the edited property, so a
// bulk caller may load a single column (bulkClientStatus.ts).
export type EditableCompanyForPlan = Pick<Company, "companyKey"> & Partial<Pick<Company, EditableCompanyProperty>>;

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
  let newValue = trimmed === "" ? null : trimmed;
  // linkedinUrl is compared in its stored form, so re-pasting the same page
  // in another shape (www, query string, trailing slash) is a no-op, and a
  // rejected value throws before anything else can run.
  if (property === "linkedinUrl" && newValue !== null) {
    const result = normalizeCompanyLinkedinUrl(newValue);
    if (!result.ok) throw new InvalidCompanyLinkedinUrlError(result.reason, newValue);
    newValue = result.value;
  }
  const oldValue = companyRow[property] ?? null;
  // domain follows the same rule. A value equal to what is already stored is
  // a no-op BEFORE validation, so an existing row is never refused by a rule
  // that is stricter than the data it already holds.
  if (property === "domain" && newValue !== null && newValue !== oldValue) {
    const result = normalizeCompanyDomain(newValue);
    if (!result.ok) throw new InvalidCompanyDomainError(result.reason, newValue);
    newValue = result.value;
  }

  if (oldValue === newValue) {
    return { changed: false, companyUpdate: null, historyRows: [] };
  }

  if (property === "ownerBdId" && newValue !== null && !context.ownerExists) {
    throw new InvalidOwnerError("unknown_bd");
  }

  if (property === "clientStatus" && newValue !== null && !isClientStatus(newValue)) {
    throw new InvalidClientStatusError(newValue);
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
