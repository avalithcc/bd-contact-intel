/**
 * Query string -> validated `/companies` list filters. One parser shared by
 * the page and the bulk action, so "select all matching the filter" resolves
 * to exactly the set the list shows. Unrecognized values are dropped, never
 * surfaced as errors (same contract as every filter validator).
 */
import { isAccountType, type AccountType } from "@/lib/companies/accountTypeFilter";
import { isClientStatusFilter, type ClientStatusFilter } from "@/lib/companies/clientStatusFilter";
import { isLinkedinPresence, type LinkedinPresence } from "@/lib/companies/linkedinPresence";

export const COMPANY_STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];
export type CompanyListViewParam = "all" | "mine" | "hiring";

export interface CompanyListParams {
  view: CompanyListViewParam;
  stage: CompanyStage | undefined;
  industry: string | undefined;
  owner: string | undefined;
  accountType: AccountType | undefined;
  clientStatus: ClientStatusFilter | undefined;
  linkedin: LinkedinPresence | undefined;
  q: string | undefined;
}

export function isCompanyStage(value: string | undefined): value is CompanyStage {
  return !!value && (COMPANY_STAGES as readonly string[]).includes(value);
}

export function isCompanyView(value: string | undefined): value is CompanyListViewParam {
  return value === "all" || value === "mine" || value === "hiring";
}

export function parseCompanyListParams(params: URLSearchParams): CompanyListParams {
  const get = (k: string) => params.get(k) ?? undefined;
  const stage = get("stage");
  const view = get("view");
  const accountType = get("accountType");
  const clientStatus = get("clientStatus");
  const linkedin = get("linkedin");
  return {
    view: isCompanyView(view) ? view : "all",
    stage: isCompanyStage(stage) ? stage : undefined,
    industry: get("industry") || undefined,
    owner: get("owner") || undefined,
    accountType: isAccountType(accountType) ? accountType : undefined,
    clientStatus: isClientStatusFilter(clientStatus) ? clientStatus : undefined,
    linkedin: isLinkedinPresence(linkedin) ? linkedin : undefined,
    q: get("q")?.trim() || undefined,
  };
}
