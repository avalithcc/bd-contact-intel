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

export type PersonStatus = "new" | "contacted" | "replied" | "meeting" | "discarded";

const PERSON_STATUSES: readonly PersonStatus[] = [
  "new",
  "contacted",
  "replied",
  "meeting",
  "discarded",
];

function isPersonStatus(value: unknown): value is PersonStatus {
  return typeof value === "string" && (PERSON_STATUSES as readonly string[]).includes(value);
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
  return params;
}

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

  return filters;
}

/** Raw ad-hoc filter query values as read straight off `searchParams` (task
 * 13.3 parity gaps: the ad-hoc "Agregar filtro" panel, task 13.1's deferred
 * scope). `undefined` means "field absent from the query string, leave the
 * inherited view value untouched"; `""` means "field present but cleared —
 * remove the inherited view value"; any other value is validated the same
 * way parseContactFilters validates it and ignored (base kept) if invalid. */
export interface AdHocContactFilterInput {
  owner?: string;
  industryGroup?: string;
  seniority?: string;
  emailStatus?: string;
}

/**
 * Layers ad-hoc filter selections (a plain `<select>` panel, no saved-view
 * jsonb involved) on top of a base filter set (the active system/saved
 * view), field by field. Only these four fields are ad-hoc-overridable —
 * `status`/`emailVerified`/`hiring` stay view-defined, per the system-views
 * design (D7) and task 12.2's scope.
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

  return result;
}
