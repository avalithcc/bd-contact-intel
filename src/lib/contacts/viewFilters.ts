/**
 * Pure serialize/parse pair for the `/contacts` list's filters (task 12.4;
 * contact-list spec; design.md "Routes": "`?view=`, filters and `?layout=
 * board` all live in the query string"). A saved view's `filters` jsonb
 * (design D7, `saved_view` table) uses this exact same shape, so
 * `sanitizeContactFilters` below is also the defensive read path for a row
 * written by an older/different app version — it never throws on
 * unexpected jsonb, it just drops what it doesn't recognize.
 *
 * No I/O — the DB glue (savedViews.ts) and the `/contacts` page import
 * this, never the other way around.
 */
import { isUuid } from "@/lib/uuid";
import { isContactType, type ContactType } from "@/lib/contacts/contactType";
import { MARKETS, type MarketKey } from "@/lib/hiring/markets";

export type PersonStatus = "new" | "contacted" | "replied" | "meeting" | "discarded";

export const PERSON_STATUSES: readonly PersonStatus[] = [
  "new",
  "contacted",
  "replied",
  "meeting",
  "discarded",
];

function isPersonStatus(value: unknown): value is PersonStatus {
  return typeof value === "string" && (PERSON_STATUSES as readonly string[]).includes(value);
}

function isMarketKey(value: unknown): value is MarketKey {
  return typeof value === "string" && (MARKETS as readonly string[]).includes(value);
}

/** 'probable'/'none' close the `/leads` parity gap (task 13.3 inventory,
 * "granular emailStatus filter"): `person.emailStatus` already carries this
 * exact vocabulary (same as contact/lead) — `emailVerified` above stays for
 * backward compatibility with existing saved views/system views, this is
 * additive. */
export type EmailStatusFilter = "verified" | "probable" | "none";

const EMAIL_STATUS_FILTERS: readonly EmailStatusFilter[] = ["verified", "probable", "none"];

function isEmailStatusFilter(value: unknown): value is EmailStatusFilter {
  return typeof value === "string" && (EMAIL_STATUS_FILTERS as readonly string[]).includes(value);
}

/** `"me"` | `"unassigned"` | a specific BD's uuid — closes the `/leads`
 * parity gap "owner = a specific BD, or unassigned" (task 13.3 inventory).
 * `"me"` stays first for backward compatibility with existing saved views
 * that only ever wrote `"me"`. */
export type OwnerFilterValue = "me" | "unassigned" | string;

function isOwnerFilterValue(value: unknown): value is OwnerFilterValue {
  return typeof value === "string" && (value === "me" || value === "unassigned" || isUuid(value));
}

export interface ContactFilters {
  owner?: OwnerFilterValue;
  status?: PersonStatus[];
  emailVerified?: boolean;
  hiring?: boolean;
  // Fed from `person.industry` at ingest (lead.industryGroup ?? industryRaw
  // — src/lib/identity/ingestWrite.ts), so this filters the same column the
  // list already displays/column-picks — no new schema needed.
  industryGroup?: string;
  seniority?: string;
  emailStatus?: EmailStatusFilter;
  // Closes the remaining 6 of 10 "Agregar filtro" options (contacts.html
  // toolbar menu) this batch adds ad-hoc-filter parity for.
  /** "Empresa" filter. Substring match against the name the row DISPLAYS —
   * free-text `person.company` when set, otherwise the canonical name via
   * `company_key` — NOT the raw `person.company` column alone. The rule is
   * `companyDisplayName.ts#companyNameMatchesTerm`; the SQL that implements
   * it is `listQueries.ts#companyNameMatchCondition`. */
  company?: string;
  /** Hiring-market crossover — reuses getHiringMatchIndex the same way the
   * Outreach view does (src/lib/outreach/queries.ts listOutreachCandidates). */
  market?: MarketKey;
  /** "Startup" filter — same getHiringMatchIndex crossover as `market`. */
  startupsOnly?: boolean;
  roleGroup?: string;
  /** "Tipo de contacto" — closed set (contactType.ts); never matches NULL rows. */
  contactType?: ContactType;
  /** "BD conectado" — a specific BD's uuid; filters to persons with a
   * `person_bd_connection` row for that BD. */
  bdConnected?: string;
  /** "Última actividad" recency bucket, in days (7/30/90/…) — filters to
   * persons whose most recent `activity` row is within the last N days. */
  lastActivityDays?: number;
  /** "Tiene teléfono" ad-hoc filter (migration 0016) — `person.phone` or
   * `person.mobilePhone` is set. */
  hasPhone?: boolean;
}

export function serializeContactFilters(filters: ContactFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (isOwnerFilterValue(filters.owner)) params.set("owner", filters.owner);
  if (filters.status?.length) params.set("status", filters.status.join(","));
  if (filters.emailVerified) params.set("emailVerified", "1");
  if (filters.hiring) params.set("hiring", "1");
  if (filters.industryGroup) params.set("industryGroup", filters.industryGroup);
  if (filters.seniority) params.set("seniority", filters.seniority);
  if (filters.emailStatus) params.set("emailStatus", filters.emailStatus);
  if (filters.company) params.set("company", filters.company);
  if (filters.market) params.set("market", filters.market);
  if (filters.startupsOnly) params.set("startupsOnly", "1");
  if (filters.roleGroup) params.set("roleGroup", filters.roleGroup);
  if (filters.contactType) params.set("contactType", filters.contactType);
  if (filters.bdConnected) params.set("bdConnected", filters.bdConnected);
  if (filters.lastActivityDays) params.set("lastActivityDays", String(filters.lastActivityDays));
  if (filters.hasPhone) params.set("hasPhone", "1");
  return params;
}

/**
 * Strict parser for serialized filters (serializeContactFilters emits "1"):
 * used by the bulk-generate action. NOT the live `/contacts` URL path, which
 * goes through applyAdHocContactFilterOverrides and is laxer (checkboxes
 * submit "on"). Keep the two in sync when adding a filter.
 */
export function parseContactFilters(params: URLSearchParams): ContactFilters {
  const filters: ContactFilters = {};

  const owner = params.get("owner");
  if (isOwnerFilterValue(owner)) filters.owner = owner;

  const statusParam = params.get("status");
  if (statusParam) {
    const values = statusParam.split(",").filter(isPersonStatus);
    if (values.length) filters.status = values;
  }

  if (params.get("emailVerified") === "1") filters.emailVerified = true;
  if (params.get("hiring") === "1") filters.hiring = true;

  const industryGroup = params.get("industryGroup");
  if (industryGroup) filters.industryGroup = industryGroup;

  const seniority = params.get("seniority");
  if (seniority) filters.seniority = seniority;

  const emailStatus = params.get("emailStatus");
  if (isEmailStatusFilter(emailStatus)) filters.emailStatus = emailStatus;

  const company = params.get("company");
  if (company) filters.company = company;

  const market = params.get("market");
  if (isMarketKey(market)) filters.market = market;

  if (params.get("startupsOnly") === "1") filters.startupsOnly = true;

  const roleGroup = params.get("roleGroup");
  if (roleGroup) filters.roleGroup = roleGroup;

  const contactType = params.get("contactType");
  if (isContactType(contactType)) filters.contactType = contactType;

  const bdConnected = params.get("bdConnected");
  if (bdConnected && isUuid(bdConnected)) filters.bdConnected = bdConnected;

  const lastActivityDaysRaw = params.get("lastActivityDays");
  if (lastActivityDaysRaw) {
    const n = Number(lastActivityDaysRaw);
    if (Number.isFinite(n) && n > 0) filters.lastActivityDays = n;
  }

  if (params.get("hasPhone") === "1") filters.hasPhone = true;

  return filters;
}

/**
 * Defensive parse for a `saved_view.filters` jsonb value: any shape can be
 * in the column (a hand-edited row, a future app version, corrupt data), so
 * this never throws — it keeps only the keys/values it recognizes.
 */
export function sanitizeContactFilters(value: unknown): ContactFilters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const filters: ContactFilters = {};

  if (isOwnerFilterValue(raw.owner)) filters.owner = raw.owner;

  if (Array.isArray(raw.status)) {
    const values = raw.status.filter(isPersonStatus);
    if (values.length) filters.status = values;
  }

  if (raw.emailVerified === true) filters.emailVerified = true;
  if (raw.hiring === true) filters.hiring = true;
  if (typeof raw.industryGroup === "string" && raw.industryGroup) filters.industryGroup = raw.industryGroup;
  if (typeof raw.seniority === "string" && raw.seniority) filters.seniority = raw.seniority;
  if (isEmailStatusFilter(raw.emailStatus)) filters.emailStatus = raw.emailStatus;
  if (typeof raw.company === "string" && raw.company) filters.company = raw.company;
  if (isMarketKey(raw.market)) filters.market = raw.market;
  if (raw.startupsOnly === true) filters.startupsOnly = true;
  if (typeof raw.roleGroup === "string" && raw.roleGroup) filters.roleGroup = raw.roleGroup;
  if (isContactType(raw.contactType)) filters.contactType = raw.contactType;
  if (typeof raw.bdConnected === "string" && isUuid(raw.bdConnected)) filters.bdConnected = raw.bdConnected;
  if (typeof raw.lastActivityDays === "number" && raw.lastActivityDays > 0) {
    filters.lastActivityDays = raw.lastActivityDays;
  }
  if (raw.hasPhone === true) filters.hasPhone = true;

  return filters;
}

/** Raw ad-hoc filter query values as read straight off `searchParams` (task
 * 13.3 parity gaps: the ad-hoc "Agregar filtro" panel, task 13.1's deferred
 * scope; extended this batch to cover all 10 mockup filter types).
 * `undefined` means "field absent from the query string, leave the
 * inherited view value untouched"; `""` means "field present but cleared —
 * remove the inherited view value"; any other value is validated the same
 * way parseContactFilters validates it and ignored (base kept) if invalid. */
export interface AdHocContactFilterInput {
  owner?: string;
  industryGroup?: string;
  seniority?: string;
  emailStatus?: string;
  // Single OR comma-joined multi-select — the mockup's status chip can show
  // several values at once ("Nuevo, Contactado").
  status?: string;
  hiring?: string;
  company?: string;
  market?: string;
  startupsOnly?: string;
  roleGroup?: string;
  contactType?: string;
  bdConnected?: string;
  lastActivityDays?: string;
  hasPhone?: string;
  emailVerified?: string;
}

/**
 * Layers ad-hoc filter selections (a plain `<select>`/checkbox panel, no
 * saved-view jsonb involved) on top of a base filter set (the active
 * system/saved view), field by field.
 */
export function applyAdHocContactFilterOverrides(
  base: ContactFilters,
  raw: AdHocContactFilterInput,
): ContactFilters {
  const result: ContactFilters = { ...base };

  if (raw.owner !== undefined) {
    if (raw.owner === "") delete result.owner;
    else if (isOwnerFilterValue(raw.owner)) result.owner = raw.owner;
  }

  if (raw.industryGroup !== undefined) {
    if (raw.industryGroup === "") delete result.industryGroup;
    else result.industryGroup = raw.industryGroup;
  }

  if (raw.seniority !== undefined) {
    if (raw.seniority === "") delete result.seniority;
    else result.seniority = raw.seniority;
  }

  if (raw.emailStatus !== undefined) {
    if (raw.emailStatus === "") delete result.emailStatus;
    else if (isEmailStatusFilter(raw.emailStatus)) result.emailStatus = raw.emailStatus;
  }

  if (raw.status !== undefined) {
    if (raw.status === "") delete result.status;
    else {
      const values = raw.status.split(",").filter(isPersonStatus);
      if (values.length) result.status = values;
    }
  }

  if (raw.hiring !== undefined) {
    if (raw.hiring === "" || raw.hiring === "0") delete result.hiring;
    else if (raw.hiring === "1") result.hiring = true;
  }

  if (raw.company !== undefined) {
    if (raw.company === "") delete result.company;
    else result.company = raw.company;
  }

  if (raw.market !== undefined) {
    if (raw.market === "") delete result.market;
    else if (isMarketKey(raw.market)) result.market = raw.market;
  }

  if (raw.startupsOnly !== undefined) {
    if (raw.startupsOnly === "" || raw.startupsOnly === "0") delete result.startupsOnly;
    else result.startupsOnly = true;
  }

  if (raw.roleGroup !== undefined) {
    if (raw.roleGroup === "") delete result.roleGroup;
    else result.roleGroup = raw.roleGroup;
  }

  if (raw.contactType !== undefined) {
    if (raw.contactType === "") delete result.contactType;
    else if (isContactType(raw.contactType)) result.contactType = raw.contactType;
  }

  if (raw.bdConnected !== undefined) {
    if (raw.bdConnected === "") delete result.bdConnected;
    else if (isUuid(raw.bdConnected)) result.bdConnected = raw.bdConnected;
  }

  if (raw.lastActivityDays !== undefined) {
    if (raw.lastActivityDays === "") delete result.lastActivityDays;
    else {
      const n = Number(raw.lastActivityDays);
      if (Number.isFinite(n) && n > 0) result.lastActivityDays = n;
    }
  }

  if (raw.hasPhone !== undefined) {
    if (raw.hasPhone === "" || raw.hasPhone === "0") delete result.hasPhone;
    else result.hasPhone = true;
  }

  if (raw.emailVerified !== undefined) {
    if (raw.emailVerified === "" || raw.emailVerified === "0") delete result.emailVerified;
    else result.emailVerified = true;
  }

  return result;
}
