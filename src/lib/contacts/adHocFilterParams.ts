/**
 * The bridge between `/contacts` search params and
 * `applyAdHocContactFilterOverrides`. The page used to enumerate the params
 * field by field; a field missing from that list was silently never applied.
 */
import type { AdHocContactFilterInput } from "@/lib/contacts/viewFilters";

/** Single-valued ad-hoc params, forwarded verbatim. `status` is separate. */
export const AD_HOC_FILTER_PARAM_KEYS = [
  "owner",
  "industryGroup",
  "seniority",
  "emailStatus",
  "company",
  "hiring",
  "market",
  "roleGroup",
  "startupsOnly",
  "bdConnected",
  "lastActivityDays",
  "hasPhone",
  "emailVerified",
] as const satisfies readonly (keyof AdHocContactFilterInput)[];

// Compile-time guard: adding a field to AdHocContactFilterInput without
// listing it above (or as `status`) fails typecheck instead of being dropped.
type MissingKeys = Exclude<keyof AdHocContactFilterInput, (typeof AD_HOC_FILTER_PARAM_KEYS)[number] | "status">;
const _allKeysForwarded: [MissingKeys] extends [never] ? true : never = true;
void _allKeysForwarded;

type RawSearchParams = Partial<Record<string, string | string[] | undefined>>;

/** Repeated `?status=` params arrive as string[]; the chip form wants CSV. */
function statusQuery(sp: RawSearchParams): string | undefined {
  const status = sp.status;
  return Array.isArray(status) ? status.join(",") : status;
}

export function contactFilterParamsFromSearchParams(sp: RawSearchParams): AdHocContactFilterInput {
  const input: AdHocContactFilterInput = { status: statusQuery(sp) };
  for (const key of AD_HOC_FILTER_PARAM_KEYS) {
    const value = sp[key];
    if (typeof value === "string") input[key] = value;
  }
  return input;
}

/** Copies every active ad-hoc filter param onto pagination/layout links. */
export function appendAdHocFilterParams(sp: RawSearchParams, params: URLSearchParams): URLSearchParams {
  const input = contactFilterParamsFromSearchParams(sp);
  if (input.status !== undefined) params.set("status", input.status);
  for (const key of AD_HOC_FILTER_PARAM_KEYS) {
    const value = input[key];
    if (value !== undefined) params.set(key, value);
  }
  return params;
}
