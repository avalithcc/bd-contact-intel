/**
 * `company.client_status` — the BD's manual statement "this company is a
 * client, and this is how it stands today". Setting `active` or `inactive`
 * IS the statement that it is a client; null means "not stated" / not a
 * client and is never backfilled or derived from activity.
 *
 * Deliberately independent of `account_type` (script-maintained, not
 * editable from the UI) and of `relationship_stage` (the sales pipeline;
 * `won` is a historical fact): this module never reads or writes either, so
 * "ganadas + inactivo" stays an answerable question.
 *
 * Free text in the DB, validated at the write boundary (propertyEdit.ts) and
 * at the URL boundary (isClientStatus) — same no-CHECK convention as
 * relationship_stage/account_type (src/db/schema.ts).
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";

export const CLIENT_STATUSES = ["active", "inactive"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export function isClientStatus(value: string | undefined): value is ClientStatus {
  return !!value && (CLIENT_STATUSES as readonly string[]).includes(value);
}

export type ClientStatusLabels = Pick<Dictionary["companyRecord"], "clientStatusActive" | "clientStatusInactive">;

/** Null renders as an em dash ("not stated"); an unrecognized value is shown
 * as-is rather than hiding data, same choice as `accountTypeLabel`. */
export function clientStatusLabel(status: string | null, l: ClientStatusLabels): string {
  switch (status) {
    case "active":
      return l.clientStatusActive;
    case "inactive":
      return l.clientStatusInactive;
    default:
      return status ?? "—";
  }
}
