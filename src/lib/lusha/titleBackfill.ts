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
 *   4. the title is not the person's own name or handle
 *   5. the returned name agrees with the CRM name; with NO CRM name, the email
 *      local-part must agree with the returned name instead
 *   6. the company agrees (see companyAgrees)
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
  | "title_is_person_name"
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

/** Lowercase, accent-free, legal suffixes dropped, everything but a-z0-9 removed. */
function compactCompany(name: string | null | undefined): string {
  if (!name) return "";
  return normalizeCompanyKey(name)
    .replace(/\bltda\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Company agreement, any of: (a) Lusha domain base == email domain base;
 * (b) Lusha name == email base; (c) one contains the other, the shorter being
 * at least 4 chars; (d) Lusha name == CRM company, when the CRM has one.
 * (b) and (c) exist because most targets have an empty person.company.
 */
function companyAgrees(l: { companyName: string | null; companyDomain: string | null }, crm: LushaTitleCrm): boolean {
  // BOTH sides go through compactCompany. They used to not: emailBase was compacted (which strips
  // the punctuation `[^a-z0-9]`) while lushaBase was raw, so an IDENTICAL hyphenated domain compared
  // "panenergy" against "pan-energy" and check (a) could never fire. A real record lost its title to
  // that: an email at pan-energy.com against Lusha's www.pan-energy.com went to needs_review.
  // Asymmetric normalization of two things being compared is always the bug.
  const emailBase = compactCompany(registrableBase(crm.email.split("@")[1] ?? ""));
  const lushaBase = l.companyDomain ? compactCompany(registrableBase(l.companyDomain)) : "";
  if (emailBase && lushaBase && emailBase === lushaBase) return true;
  const name = compactCompany(l.companyName);
  if (name && emailBase) {
    if (name === emailBase) return true;
    const [short, long] = name.length <= emailBase.length ? [name, emailBase] : [emailBase, name];
    if (short.length >= 4 && long.includes(short)) return true;
  }
  const crmCompany = compactCompany(crm.company);
  return name !== "" && name === crmCompany;
}

function stripAccents(v: string): string {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Guard 4. A title that is the person's own name or a handle built from it
 * (e.g. a LinkedIn slug) is junk. Rejects when a title token equals a 4+ char
 * name token, when the letters of the title equal first+last (either order),
 * or when a one-word title that classifies to "other" contains a name token.
 * The last clause is limited to "other" so "Marketing" is not killed by a
 * first name "Mark".
 */
function titleIsPersonName(title: string, first: string | null, last: string | null): boolean {
  const nameToks = nameTokens(first, last).filter((t) => t.length >= 4);
  const letters = stripAccents(title).replace(/[^a-z]/g, "");
  const f = stripAccents(first ?? "").replace(/[^a-z]/g, "");
  const l = stripAccents(last ?? "").replace(/[^a-z]/g, "");
  if (letters && (letters === f + l || letters === l + f)) return true;
  const titleToks = stripAccents(title).split(/[^a-z]+/).filter(Boolean);
  if (titleToks.some((t) => nameToks.includes(t))) return true;
  const oneWord = !/\s/.test(title.trim());
  return oneWord && classifyPosition(title) === "other" && nameToks.some((t) => letters.includes(t));
}

/** Guard 5 fallback, only for a CRM person with no usable name: the email local-part vs the returned name. */
function localPartAgrees(email: string, first: string | null, last: string | null): boolean {
  const local = stripAccents(email.split("@")[0] ?? "");
  const localToks = local.split(/[^a-z]+/).filter((t) => t.length >= 4);
  const returned = nameTokens(first, last).filter((t) => t.length >= 4);
  return localToks.some((lt) => returned.some((rt) => lt.includes(rt) || rt.includes(lt)));
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
  if (titleIsPersonName(title, lusha.firstName, lusha.lastName)) return skip("title_is_person_name");
  // Writing role_group "other" is correct here, unlike writing Lusha's literal
  // "Other" (guard 3): "other" from classifyPosition means "we know the title
  // and it is none of our groups", strictly more information than
  // "no_position" ("we know nothing"). Lusha's "Other" is Lusha saying it does
  // not know, so it would turn missing data into a false "known" fact.
  const group = classifyPosition(title);
  if (group === "no_position") return skip("no_title");

  // Guard 5
  const crmTokens = nameTokens(crm.firstName, crm.lastName);
  if (crmTokens.length === 0) {
    if (!localPartAgrees(crm.email, lusha.firstName, lusha.lastName)) return skip("needs_review_no_crm_name");
  } else {
    const returned = new Set(nameTokens(lusha.firstName, lusha.lastName));
    if (!crmTokens.some((t) => returned.has(t))) return skip("needs_review_name_mismatch");
  }

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
