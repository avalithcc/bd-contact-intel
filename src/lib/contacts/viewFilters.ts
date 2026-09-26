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

export interface ContactFilters {
  // "me" is the only owner value today — the mockup's "Responsable"
  // ad-hoc-BD filter is out of this phase's scope (see tasks.md 12.2-12.4).
  owner?: "me";
  status?: PersonStatus[];
  emailVerified?: boolean;
  hiring?: boolean;
}

export function serializeContactFilters(filters: ContactFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.owner === "me") params.set("owner", "me");
  if (filters.status?.length) params.set("status", filters.status.join(","));
  if (filters.emailVerified) params.set("emailVerified", "1");
  if (filters.hiring) params.set("hiring", "1");
  return params;
}

export function parseContactFilters(params: URLSearchParams): ContactFilters {
  const filters: ContactFilters = {};

  if (params.get("owner") === "me") filters.owner = "me";

  const statusParam = params.get("status");
  if (statusParam) {
    const values = statusParam.split(",").filter(isPersonStatus);
    if (values.length) filters.status = values;
  }

  if (params.get("emailVerified") === "1") filters.emailVerified = true;
  if (params.get("hiring") === "1") filters.hiring = true;

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

  if (raw.owner === "me") filters.owner = "me";

  if (Array.isArray(raw.status)) {
    const values = raw.status.filter(isPersonStatus);
    if (values.length) filters.status = values;
  }

  if (raw.emailVerified === true) filters.emailVerified = true;
  if (raw.hiring === true) filters.hiring = true;

  return filters;
}
