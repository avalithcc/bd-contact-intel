import { eq, isNull, type SQL } from "drizzle-orm";
import { company } from "@/db/schema";
import { isClientStatus, type ClientStatus } from "@/lib/companies/clientStatus";

/**
 * `/companies` list client-status filter — same shape as
 * accountTypeFilter.ts. Plain equality on `company.client_status`; the
 * vocabulary and URL-param validator (`isClientStatus`) live in
 * clientStatus.ts. `"none"` is the filter-only value for "not stated" (the
 * column is NULL): it is never stored, the mockup's "Sin declarar" chip.
 * `undefined` in, `undefined` out: the caller only pushes a condition when
 * one comes back. Db-free so it is unit-testable without a live
 * `DATABASE_URL`.
 */
export const CLIENT_STATUS_FILTER_NONE = "none";
export type ClientStatusFilter = ClientStatus | typeof CLIENT_STATUS_FILTER_NONE;

export function isClientStatusFilter(value: string | undefined): value is ClientStatusFilter {
  return value === CLIENT_STATUS_FILTER_NONE || isClientStatus(value);
}

export function clientStatusCondition(clientStatus: ClientStatusFilter | undefined): SQL | undefined {
  if (clientStatus === CLIENT_STATUS_FILTER_NONE) return isNull(company.clientStatus);
  return clientStatus ? eq(company.clientStatus, clientStatus) : undefined;
}
