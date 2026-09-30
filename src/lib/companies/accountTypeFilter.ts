import { eq, type SQL } from "drizzle-orm";
import { company } from "@/db/schema";

/**
 * `/companies` list account-type filter (BACKLOG.md Layer 3
 * "account-type-filter"). `company.account_type` is a curated, read-only
 * classification ('partner' | 'client' | 'strategic_org' — 30 partner / 2
 * client / rest null in prod as of this writing, see listMappers.ts's
 * `accountTypeLabel` doc comment). This module only lets the list FILTER by
 * it, same boundary as the record page's display-only row — reclassifying
 * an account's type stays out of scope (owner-undecided).
 */
export const ACCOUNT_TYPES = ["partner", "client", "strategic_org"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * URL param validator — same ignore-invalid contract as the page's own
 * `isStage`/`isView` guards (src/app/(app)/companies/page.tsx): an
 * unrecognized or missing value is simply not applied as a filter, never
 * surfaced as an error.
 */
export function isAccountType(value: string | undefined): value is AccountType {
  return !!value && (ACCOUNT_TYPES as readonly string[]).includes(value);
}

/**
 * WHERE condition builder, split out of listQueries.ts so it's
 * unit-testable without a live `DATABASE_URL` — `src/db/index.ts` throws at
 * import time when unset, and listQueries.ts imports `db` from there.
 * `undefined` in, `undefined` out: the caller only pushes a condition into
 * its `conditions[]` array when one comes back, same as the stage/industry/
 * owner conditions already built inline in `getCompanyListPage`.
 */
export function accountTypeCondition(accountType: AccountType | undefined): SQL | undefined {
  return accountType ? eq(company.accountType, accountType) : undefined;
}
