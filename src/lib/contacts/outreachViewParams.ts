/**
 * Query-param parse/build pair for `/contacts?view=outreach` (task 15a-2;
 * owner decision 2026-09-26: the new view must expose the SAME filters as
 * `/outreach` — src/app/(app)/outreach/page.tsx). Pure — no DB, no i18n —
 * mirrors src/lib/contacts/viewFilters.ts's serialize/parse pair for the
 * rest of `/contacts`, kept separate since the outreach candidate model
 * (OutreachFilters) is shaped differently (a hiring-index crossover, not a
 * plain SQL WHERE on `person`) and isn't a `ContactFilters`.
 */
import { ROLE_GROUPS, type RoleGroupKey } from "@/lib/roleGroups";
import { COMPANY_CATEGORIES, type CompanyCategoryKey } from "@/lib/companyCategories";
import { isMarketKey } from "@/lib/hiring/markets";
import type { OutreachFilters } from "@/lib/outreach/ranking";

const ROLE_GROUP_KEYS = new Set(ROLE_GROUPS.map((g) => g.key));
const COMPANY_CATEGORY_KEYS = new Set(COMPANY_CATEGORIES.map((c) => c.key));

export function isRoleGroupKey(v: string | undefined): v is RoleGroupKey {
  return !!v && ROLE_GROUP_KEYS.has(v as RoleGroupKey);
}

export function isCompanyCategoryKey(v: string | undefined): v is CompanyCategoryKey {
  return !!v && COMPANY_CATEGORY_KEYS.has(v as CompanyCategoryKey);
}

/** Raw values as read straight off `searchParams` — same shape/semantics as
 * `/outreach`'s own searchParams (same param names, so the eventual
 * `/outreach` -> `/contacts?view=outreach` redirect mapping, task 15c, is a
 * straight pass-through for every field here). */
export interface OutreachViewSearchParams {
  roleGroup?: string;
  companyCategory?: string;
  market?: string;
  miamiOnly?: string;
  excludeNever?: string;
  hideOffshore?: string;
  startupsOnly?: string;
  name?: string;
}

export function parseOutreachViewFilters(sp: OutreachViewSearchParams): OutreachFilters {
  const roleGroup = isRoleGroupKey(sp.roleGroup) ? sp.roleGroup : undefined;
  const companyCategory = isCompanyCategoryKey(sp.companyCategory) ? sp.companyCategory : undefined;
  const market = isMarketKey(sp.market) ? sp.market : undefined;
  // Only meaningful (and only ever rendered as a control) alongside
  // `market === "us"` — same guard as /outreach/page.tsx's own miamiOnly.
  const miamiOnly = market === "us" && sp.miamiOnly === "on";
  const includeNeverMessaged = sp.excludeNever !== "on";
  const hideOffshore = sp.hideOffshore === "on";
  const startupsOnly = sp.startupsOnly === "on";
  const name = sp.name?.trim() || undefined;

  const filters: OutreachFilters = { includeNeverMessaged, hideOffshore, startupsOnly };
  if (roleGroup) filters.roleGroup = roleGroup;
  if (companyCategory) filters.companyCategory = companyCategory;
  if (market) filters.market = market;
  // Only meaningful alongside market "us" — present (true or false) exactly
  // when market is "us", absent otherwise, same as /outreach's own control.
  if (market === "us") filters.miamiOnly = miamiOnly;
  if (name) filters.name = name;
  return filters;
}

/** Builds the `?view=outreach&...` query string for pagination/filter-panel
 * links — carries every valid outreach filter param along so they never
 * silently reset on pagination, same convention as
 * `withAdHocFilterParams` for the rest of `/contacts`. */
export function buildOutreachViewParams(sp: OutreachViewSearchParams, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("view", "outreach");
  if (isRoleGroupKey(sp.roleGroup)) params.set("roleGroup", sp.roleGroup);
  if (isCompanyCategoryKey(sp.companyCategory)) params.set("companyCategory", sp.companyCategory);
  if (isMarketKey(sp.market)) params.set("market", sp.market);
  if (sp.market === "us" && sp.miamiOnly === "on") params.set("miamiOnly", "on");
  if (sp.excludeNever === "on") params.set("excludeNever", "on");
  if (sp.hideOffshore === "on") params.set("hideOffshore", "on");
  if (sp.startupsOnly === "on") params.set("startupsOnly", "on");
  const name = sp.name?.trim();
  if (name) params.set("name", name);
  params.set("page", String(page));
  return params;
}

/** `/outreach` -> `/contacts?view=outreach` redirect (task 15c): every field
 * on `/outreach`'s own searchParams shares its exact name/semantics with
 * `OutreachViewSearchParams` above (deliberate, see that type's doc
 * comment), so this is a straight pass-through via `buildOutreachViewParams`
 * — no new mapping logic, unlike `/leads`'s redirect (buildContactsRedirectQuery)
 * which had to translate several renamed/reshaped fields. No I/O —
 * `/outreach/page.tsx` calls `redirect()` with this string. */
export function buildOutreachRedirectQuery(sp: OutreachViewSearchParams & { page?: string }): string {
  const page = Math.max(1, Number(sp.page) || 1);
  return buildOutreachViewParams(sp, page).toString();
}
