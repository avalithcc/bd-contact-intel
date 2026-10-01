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

/**
 * Checkbox-kind params. An unchecked checkbox submits nothing, so "the user
 * unchecked it" is indistinguishable from "the editor was never submitted" and
 * a value inherited from a saved/system view would survive. Each checkbox
 * editor therefore also submits `<field>__set=1` (a different name, so the
 * field itself never repeats and stays a single string).
 */
export const CHECKBOX_FILTER_PARAM_KEYS = [
  "hiring",
  "startupsOnly",
  "hasPhone",
  "emailVerified",
] as const satisfies readonly (typeof AD_HOC_FILTER_PARAM_KEYS)[number][];

export function isCheckboxFilterKey(name: string): name is (typeof CHECKBOX_FILTER_PARAM_KEYS)[number] {
  return (CHECKBOX_FILTER_PARAM_KEYS as readonly string[]).includes(name);
}

export function checkboxSubmitMarker(field: (typeof CHECKBOX_FILTER_PARAM_KEYS)[number]): string {
  return `${field}__set`;
}

export function contactFilterParamsFromSearchParams(sp: RawSearchParams): AdHocContactFilterInput {
  const input: AdHocContactFilterInput = { status: statusQuery(sp) };
  for (const key of AD_HOC_FILTER_PARAM_KEYS) {
    const value = sp[key];
    if (typeof value === "string") input[key] = value;
  }
  // Marker present but no usable value: the box was unchecked -> explicit clear.
  for (const key of CHECKBOX_FILTER_PARAM_KEYS) {
    if (input[key] === undefined && sp[checkboxSubmitMarker(key)] !== undefined) input[key] = "";
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
