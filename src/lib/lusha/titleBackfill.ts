/**
 * Pure planner for backfilling `person.job_title` (and the role_group derived
 * from it) from a Lusha lookup, for persons whose role_group is "no_position".
 * No DB access: scripts/backfill-job-titles-from-lusha.ts loads the snapshot
 * and applies the writes.
 *
 * A write happens only when all six guards pass, in this order:
 *   1. target still qualifies (role_group no_position, blank job_title)
 *   2. Lusha returned a title
 *   3. the title is not Lusha's "Other" (its way of saying it does not know)
 *   4. the title classifies to a real group (not other / no_position)
 *   5. the returned name agrees with the CRM name (needs a CRM name)
 *   6. the company agrees, by email-domain base OR normalized company name
 * Skips caused by 5 and 6 are "needs_review_*": a human can adjudicate them.
 */
import type { NewPersonPropertyHistory } from "@/db/schema";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { classifyPosition } from "@/lib/roleGroups";

/** Provenance on every history row; the capture date makes the batch revertable as a unit. */
export const LUSHA_TITLE_SOURCE = "lusha_title_backfill_2026-11-24";

export type LushaTitleRecord =
  | { email: string; notFound: true }
  | {
      email: string;
      notFound?: false;
      firstName: string | null;
      lastName: string | null;
      title: string | null;
      seniority?: string | null;
      companyName: string | null;
      companyDomain: string | null;
    };

export interface LushaTitleCrm {
  personId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  roleGroup: string | null;
}

export type LushaSkipReason =
  | "not_found_at_lusha"
  | "no_person"
  | "role_group_not_no_position"
  | "crm_title_present"
  | "no_title"
  | "lusha_unknown_title"
  | "title_unclassifiable"
  | "needs_review_no_crm_name"
  | "needs_review_name_mismatch"
  | "needs_review_company_mismatch";

type HistoryRow = Omit<NewPersonPropertyHistory, "id" | "at">;

export type LushaTitlePlan =
  | { action: "write"; personId: string; jobTitle: string; roleGroup: string; historyRows: HistoryRow[] }
  | { action: "skip"; reason: LushaSkipReason };

const SECOND_LEVEL = new Set(["com", "net", "org", "co", "gov", "edu", "ac", "gob", "gub"]);

/** Registrable base of a host: strips "www." and the public suffix (".com", ".com.ar"). */
export function registrableBase(host: string): string {
  const labels = host
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (labels.length <= 1) return labels[0] ?? "";
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const suffixLen = last.length === 2 && SECOND_LEVEL.has(second) && labels.length >= 3 ? 2 : 1;
  return labels[labels.length - suffixLen - 1];
}

function nameTokens(...parts: Array<string | null | undefined>): string[] {
  return parts
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3);
}

function compactCompany(name: string | null | undefined): string {
  return name ? normalizeCompanyKey(name).replace(/[^a-z0-9]/g, "") : "";
}

function companyAgrees(l: { companyName: string | null; companyDomain: string | null }, crm: LushaTitleCrm): boolean {
  const emailHost = crm.email.split("@")[1] ?? "";
  const emailBase = registrableBase(emailHost);
  const lushaBase = l.companyDomain ? registrableBase(l.companyDomain) : "";
  if (emailBase && lushaBase && emailBase === lushaBase) return true;
  const a = compactCompany(l.companyName);
  const b = compactCompany(crm.company);
  return a !== "" && a === b;
}

export function planLushaTitle(lusha: LushaTitleRecord, crm: LushaTitleCrm | null): LushaTitlePlan {
  const skip = (reason: LushaSkipReason): LushaTitlePlan => ({ action: "skip", reason });
  if (lusha.notFound) return skip("not_found_at_lusha");
  if (!crm) return skip("no_person");

  // Guard 1
  if (crm.roleGroup !== "no_position") return skip("role_group_not_no_position");
  if (crm.jobTitle != null && crm.jobTitle.trim() !== "") return skip("crm_title_present");

  // Guards 2-4
  const title = lusha.title?.trim() ?? "";
  if (!title) return skip("no_title");
  if (title.toLowerCase() === "other") return skip("lusha_unknown_title");
  const group = classifyPosition(title);
  if (group === "other" || group === "no_position") return skip("title_unclassifiable");

  // Guard 5
  const crmTokens = nameTokens(crm.firstName, crm.lastName);
  if (crmTokens.length === 0) return skip("needs_review_no_crm_name");
  const returned = new Set(nameTokens(lusha.firstName, lusha.lastName));
  if (!crmTokens.some((t) => returned.has(t))) return skip("needs_review_name_mismatch");

  // Guard 6
  if (!companyAgrees(lusha, crm)) return skip("needs_review_company_mismatch");

  const base = { personId: crm.personId, changedByBdId: null, source: LUSHA_TITLE_SOURCE };
  return {
    action: "write",
    personId: crm.personId,
    jobTitle: title,
    roleGroup: group,
    historyRows: [
      { ...base, property: "jobTitle", oldValue: crm.jobTitle ?? null, newValue: title },
      { ...base, property: "roleGroup", oldValue: crm.roleGroup, newValue: group },
    ],
  };
}
