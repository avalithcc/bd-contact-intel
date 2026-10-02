import { eq, type SQL } from "drizzle-orm";
import { company } from "@/db/schema";
import type { ClientStatus } from "@/lib/companies/clientStatus";

/**
 * `/companies` list client-status filter — same shape as
 * accountTypeFilter.ts. Plain equality on `company.client_status`; the
 * vocabulary and URL-param validator (`isClientStatus`) live in
 * clientStatus.ts. `undefined` in, `undefined` out: the caller only pushes a
 * condition when one comes back. Db-free so it is unit-testable without a
 * live `DATABASE_URL`.
 */
export function clientStatusCondition(clientStatus: ClientStatus | undefined): SQL | undefined {
  return clientStatus ? eq(company.clientStatus, clientStatus) : undefined;
}
