/**
 * Pure planner for the hotel-sheet import (scripts/import-hoteles-2026-10.ts).
 * No DB access: db.ts prefetches a `PlanContext` and calls `buildHotelPlan`.
 * Never mutates its inputs; ids come from an injected generator.
 *
 * IDENTITY KEYING (who counts as "already there"), in precedence order:
 *   1. email_normalized                     (rows with an email)
 *   2. LinkedIn profile key                 (all email-less rows in this sheet)
 *   3. name + company key, same source only (fallback; matcher "review")
 * Decisions come from the shared matcher (src/lib/identity/matcher.ts) with
 * the `manual_create` source, so an exact email or profile key is an `auto`
 * match. A match on a person this import created = already imported (a
 * no-op, which is what makes re-runs idempotent). A match on a person from
 * ANY OTHER source is never written over: it is skipped and reported for the
 * owner. Rows with none of the three keys are skipped (`no_identity_key`).
 */
import { randomUUID } from "node:crypto";
import type { NewPerson } from "@/db/schema";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { buildNameCompanyKey, matchIdentity } from "@/lib/identity/matcher";
import { classifyPosition } from "@/lib/roleGroups";
import { HOTELES_SOURCE_KEY, type HotelRow, type ParsedHotelSheet, type PhoneResult, type RowSkip } from "./rows";

export interface ExistingPerson {
  id: string;
  sourceKey: string | null;
  profileKey: string | null;
  emailNormalized: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
}

export interface ExistingCompany {
  companyKey: string;
  displayName: string;
  ownerBdId: string | null;
}

export interface PlanContext {
  marielBdId: string;
  /** Non-merged persons matching ANY of this sheet's emails / profile keys / company keys (see prefetchKeys). */
  candidates: readonly ExistingPerson[];
  /** `company_alias.alias_key` -> canonical `company_key`. */
  companyAliasByKey: ReadonlyMap<string, string>;
  existingCompaniesByKey: ReadonlyMap<string, ExistingCompany>;
}

export interface CompanyToCreate {
  companyKey: string;
  displayName: string;
  country: string | null;
}

export type PlanSkipReason = RowSkip["reason"] | "no_identity_key" | "exists_other_source" | "possible_duplicate" | "own_company";

export interface PlanSkip {
  line: number;
  reason: PlanSkipReason;
  personId?: string;
}

export interface HotelReport {
  rowsRead: number;
  rowsKept: number;
  collapsedInFile: { lines: number[] }[];
  skipped: PlanSkip[];
  alreadyImported: number;
  toCreate: number;
  withEmail: number;
  withoutEmail: number;
  emailLess: { total: number; keyedByProfile: number; keyedByNameCompany: number };
  contactTypes: Record<string, number>;
  roleGroups: Record<string, number>;
  countries: Record<string, number>;
  companiesToCreate: number;
  companiesOwnedByOther: string[];
  phones: { phoneWritten: number; mobileWritten: number; rejectedLines: number[]; addedPlusLines: number[]; collapsedLines: number[]; dialMismatchLines: number[] };
  ignoredColumns: string[];
}

export interface HotelPlan {
  creates: NewPerson[];
  companiesToCreate: CompanyToCreate[];
  /** Existing, currently unowned companies that get Mariel as owner. */
  companyOwnerUpdates: string[];
  report: HotelReport;
}

/** The ONE company_key builder: planner and db prefetch both call it. */
export function resolveHotelCompanyKey(raw: string, aliasByKey: ReadonlyMap<string, string>): string {
  const key = normalizeCompanyKey(raw);
  return aliasByKey.get(key) ?? key;
}

/** What db.ts must prefetch for a parsed sheet (same normalisers the planner uses). */
export function prefetchKeys(rows: readonly HotelRow[]) {
  const uniq = <T>(xs: (T | null)[]): T[] => [...new Set(xs.filter((x): x is T => x !== null))];
  return {
    emails: uniq(rows.map((r) => r.emailNormalized)),
    profileKeys: uniq(rows.map((r) => r.profileKey)),
    rawCompanyKeys: uniq(rows.map((r) => (r.company ? normalizeCompanyKey(r.company) : null))),
  };
}

const completeness = (r: HotelRow) => [r.company, r.jobTitle, r.email, r.profileKey, r.phone.value, r.mobilePhone.value].filter(Boolean).length;

function rowKeys(r: HotelRow, companyKey: string | null): string[] {
  const keys = [r.emailNormalized && `e:${r.emailNormalized}`, r.profileKey && `p:${r.profileKey}`];
  if (!r.emailNormalized && !r.profileKey) keys.push(buildNameCompanyKey({ firstName: r.firstName, lastName: r.lastName, companyKey }));
  return keys.filter((k): k is string => !!k);
}

/** Rows that are the same person (shared email / profile key) collapse to the most complete one. */
function collapseRows(rows: readonly HotelRow[], keyOf: (r: HotelRow) => string | null) {
  const kept: HotelRow[] = [];
  const byKey = new Map<string, number>();
  const linesByIdx = new Map<number, number[]>();
  for (const row of rows) {
    const keys = rowKeys(row, keyOf(row));
    const hit = keys.map((k) => byKey.get(k)).find((i): i is number => i !== undefined);
    if (hit === undefined) {
      kept.push(row);
      for (const k of keys) byKey.set(k, kept.length - 1);
      continue;
    }
    linesByIdx.set(hit, [...(linesByIdx.get(hit) ?? [kept[hit]!.line]), row.line]);
    if (completeness(row) > completeness(kept[hit]!)) kept[hit] = row;
    for (const k of keys) byKey.set(k, hit);
  }
  return { kept, collapsedInFile: [...linesByIdx.values()].map((lines) => ({ lines })) };
}

function buildIndex(candidates: readonly ExistingPerson[]) {
  const byProfile = new Map<string, string>();
  const byEmail = new Map<string, string[]>();
  const byNameCompany = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, id: string) => m.set(k, [...(m.get(k) ?? []), id]);
  for (const c of candidates) {
    if (c.profileKey && !byProfile.has(c.profileKey)) byProfile.set(c.profileKey, c.id);
    if (c.emailNormalized) push(byEmail, c.emailNormalized, c.id);
    const nc = buildNameCompanyKey({ firstName: c.firstName, lastName: c.lastName, company: c.company, companyKey: c.companyKey });
    if (nc) push(byNameCompany, nc, c.id);
  }
  return {
    byProfileKey: (k: string) => byProfile.get(k) ?? null,
    byVerifiedEmail: () => null,
    byEmail: (e: string) => byEmail.get(e) ?? [],
    byNameCompany: (k: string) => byNameCompany.get(k) ?? [],
  };
}

const bump = (m: Record<string, number>, k: string) => void (m[k] = (m[k] ?? 0) + 1);

export function buildHotelPlan(parsed: ParsedHotelSheet, ctx: PlanContext, genId: () => string = randomUUID): HotelPlan {
  const keyOf = (r: HotelRow) => (r.company ? resolveHotelCompanyKey(r.company, ctx.companyAliasByKey) : null);
  const { kept, collapsedInFile } = collapseRows(parsed.rows, keyOf);
  const index = buildIndex(ctx.candidates);
  const sourceById = new Map(ctx.candidates.map((c) => [c.id, c.sourceKey]));
  const isOurs = (ids: readonly string[]) => ids.every((id) => sourceById.get(id) === HOTELES_SOURCE_KEY);

  const skipped: PlanSkip[] = [...parsed.skipped];
  const creates: NewPerson[] = [];
  const createdRows: HotelRow[] = [];
  let alreadyImported = 0;

  for (const row of kept) {
    const companyKey = keyOf(row);
    if (!row.emailNormalized && !row.profileKey && !buildNameCompanyKey({ firstName: row.firstName, lastName: row.lastName, companyKey })) {
      skipped.push({ line: row.line, reason: "no_identity_key" });
      continue;
    }
    const match = matchIdentity(
      { profileKey: row.profileKey, email: row.email, emailStatus: "probable", firstName: row.firstName, lastName: row.lastName, company: row.company, companyKey, source: "manual_create" },
      index,
    );
    if (match.kind === "skip_own_company") skipped.push({ line: row.line, reason: "own_company" });
    else if (match.kind === "auto" || match.kind === "review") {
      const ids = match.kind === "auto" ? [match.personId] : match.personIds;
      if (isOurs(ids)) alreadyImported++;
      else skipped.push({ line: row.line, reason: match.kind === "auto" ? "exists_other_source" : "possible_duplicate", personId: ids.find((id) => sourceById.get(id) !== HOTELES_SOURCE_KEY)! });
    } else {
      createdRows.push(row);
      creates.push(buildPerson(row, companyKey, ctx.marielBdId, genId()));
    }
  }

  // Companies: only those a created person points at.
  const companiesToCreate = new Map<string, CompanyToCreate>();
  const ownerUpdates = new Set<string>();
  const ownedByOther = new Set<string>();
  for (const row of createdRows) {
    const key = keyOf(row);
    if (!key) continue;
    const existing = ctx.existingCompaniesByKey.get(key);
    if (!existing) {
      const prev = companiesToCreate.get(key);
      if (!prev) companiesToCreate.set(key, { companyKey: key, displayName: row.company!, country: row.country });
      else if (!prev.country && row.country) prev.country = row.country;
    } else if (!existing.ownerBdId) ownerUpdates.add(key);
    else if (existing.ownerBdId !== ctx.marielBdId) ownedByOther.add(key);
  }

  const report: HotelReport = {
    rowsRead: parsed.rowsRead,
    rowsKept: kept.length,
    collapsedInFile,
    skipped: skipped.sort((a, b) => a.line - b.line),
    alreadyImported,
    toCreate: creates.length,
    withEmail: createdRows.filter((r) => r.email).length,
    withoutEmail: createdRows.filter((r) => !r.email).length,
    emailLess: {
      total: createdRows.filter((r) => !r.email).length,
      keyedByProfile: createdRows.filter((r) => !r.email && r.profileKey).length,
      keyedByNameCompany: createdRows.filter((r) => !r.email && !r.profileKey).length,
    },
    contactTypes: {},
    roleGroups: {},
    countries: {},
    companiesToCreate: companiesToCreate.size,
    companiesOwnedByOther: [...ownedByOther],
    phones: phoneStats(createdRows),
    ignoredColumns: parsed.ignoredColumns,
  };
  for (const c of creates) {
    bump(report.contactTypes, c.contactType!);
    bump(report.roleGroups, c.roleGroup!);
    if (c.country) bump(report.countries, c.country);
  }
  return { creates, companiesToCreate: [...companiesToCreate.values()], companyOwnerUpdates: [...ownerUpdates], report };
}

function buildPerson(row: HotelRow, companyKey: string | null, ownerBdId: string, id: string): NewPerson {
  return {
    id,
    profileKey: row.profileKey,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    emailNormalized: row.emailNormalized,
    // Sheet-sourced, never verified.
    emailStatus: row.email ? "probable" : "none",
    emailSource: row.email ? HOTELES_SOURCE_KEY : null,
    phone: row.phone.value,
    mobilePhone: row.mobilePhone.value,
    company: row.company,
    companyKey,
    jobTitle: row.jobTitle,
    roleGroup: classifyPosition(row.jobTitle),
    contactType: row.contactType,
    country: row.country,
    ownerBdId,
    status: "new",
    sourceKey: HOTELES_SOURCE_KEY,
  };
}

function phoneStats(rows: readonly HotelRow[]): HotelReport["phones"] {
  const lines = (pick: (p: PhoneResult) => boolean) => rows.filter((r) => pick(r.phone) || pick(r.mobilePhone)).map((r) => r.line);
  return {
    phoneWritten: rows.filter((r) => r.phone.value).length,
    mobileWritten: rows.filter((r) => r.mobilePhone.value).length,
    rejectedLines: lines((p) => p.rejected),
    addedPlusLines: lines((p) => p.normalised === "added_plus"),
    collapsedLines: lines((p) => p.normalised === "collapsed_whitespace"),
    dialMismatchLines: lines((p) => p.dialMismatch),
  };
}
