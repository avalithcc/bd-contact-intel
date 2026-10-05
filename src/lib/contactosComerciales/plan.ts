/**
 * Pure planner for the commercial-contacts import
 * (scripts/import-contactos-comerciales-2026-10.ts). No DB access: db.ts
 * prefetches a `PlanContext` and calls `buildComercialPlan`. Never mutates its
 * inputs; ids come from an injected generator.
 *
 * Identity is the email, lowercased (emailKey). Decisions go through the
 * shared matcher (src/lib/identity/matcher.ts, source `manual_create`) with an
 * email-only index, so an Avalith address is skipped as own company. Name and
 * company are NOT identity keys here: the company column is a guess and some
 * names are inferred from the email.
 *
 *   - no live person has the email  -> create (owner Mariel, automatic owner rule)
 *   - exactly one has it            -> fill-empty phone ONLY; a contact that
 *                                      already has any number is skipped and counted
 *   - several have it               -> write nothing, count as ambiguous
 */
import { randomUUID } from "node:crypto";
import type { NewPerson, NewPersonPropertyHistory } from "@/db/schema";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { matchIdentity, type IdentityIndex } from "@/lib/identity/matcher";
import { resolveHotelCompanyKey } from "@/lib/hoteles2026/plan";
import { emailKey, normalizeComercialPhone, type ComercialRow } from "./parse";

export const CONTACTOS_SOURCE_KEY = "contactos-comerciales-2026-10";
/** History property that marks a name the PDF said was derived from the email. */
export const NAME_INFERRED_PROPERTY = "nameInferred";
/** Never `edit`: that source would make the owner sticky (src/lib/identity/ownerRule.ts). */
const HISTORY_SOURCE = "import";

export interface ExistingPerson {
  id: string;
  emailNormalized: string;
  phone: string | null;
  mobilePhone: string | null;
}

export interface PlanContext {
  ownerBdId: string;
  /** Live (non-merged) persons whose email_normalized is among the file's emails. */
  existing: readonly ExistingPerson[];
  /** `company_alias.alias_key` -> canonical `company_key`. */
  companyAliasByKey: ReadonlyMap<string, string>;
}

export interface PhoneFill {
  personId: string;
  phone: string | null;
  mobilePhone: string | null;
}

export interface ComercialReport {
  rowsParsed: number;
  duplicatesInFile: number;
  matched: number;
  ambiguous: number;
  skippedOwnCompany: number;
  toCreate: number;
  newWithPhone: number;
  phonePersonsFilled: number;
  phoneColumnsFilled: number;
  /** Matched contacts for which the file brings a number but who already have one. */
  skippedHasPhone: number;
  /** Extensions removed from numbers that will be stored / from every valid number in the file. */
  extensionsDropped: number;
  extensionsDroppedInFile: number;
  invalidNumbers: number;
  /** Valid numbers beyond the second, which have no column to go to. */
  extraNumbersDropped: number;
  rowsWithLastContact: number;
  inferredNamesLoaded: number;
  inferredNamesOnExisting: number;
}

export interface ComercialPlan {
  creates: NewPerson[];
  fills: PhoneFill[];
  historyRows: NewPersonPropertyHistory[];
  report: ComercialReport;
}

/** What db.ts must prefetch for a parsed file (same normalisers the planner uses). */
export function prefetchKeys(rows: readonly ComercialRow[]) {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => x !== null))];
  return {
    emails: uniq(rows.map((r) => emailKey(r.email))),
    rawCompanyKeys: uniq(rows.map((r) => (r.company ? normalizeCompanyKey(r.company) : null))),
  };
}

const digitsOf = (v: string) => v.replace(/\D/g, "");
const isBlank = (v: string | null) => !v || v.trim() === "";

export function buildComercialPlan(rowsIn: readonly ComercialRow[], ctx: PlanContext, genId: () => string = randomUUID): ComercialPlan {
  const byEmail = new Map<string, ExistingPerson[]>();
  for (const p of ctx.existing) byEmail.set(p.emailNormalized, [...(byEmail.get(p.emailNormalized) ?? []), p]);
  const index: IdentityIndex = {
    byProfileKey: () => null,
    byVerifiedEmail: () => null,
    byEmail: (e) => (byEmail.get(e) ?? []).map((p) => p.id),
    byNameCompany: () => [],
  };

  const report: ComercialReport = {
    rowsParsed: rowsIn.length, duplicatesInFile: 0, matched: 0, ambiguous: 0, skippedOwnCompany: 0, toCreate: 0, newWithPhone: 0,
    phonePersonsFilled: 0, phoneColumnsFilled: 0, skippedHasPhone: 0, extensionsDropped: 0, extensionsDroppedInFile: 0,
    invalidNumbers: 0, extraNumbersDropped: 0, rowsWithLastContact: rowsIn.filter((r) => r.lastContact).length, inferredNamesLoaded: 0, inferredNamesOnExisting: 0,
  };
  const creates: NewPerson[] = [];
  const fills: PhoneFill[] = [];
  const historyRows: NewPersonPropertyHistory[] = [];
  const seen = new Set<string>();

  for (const row of rowsIn) {
    const key = emailKey(row.email);
    if (seen.has(key)) {
      report.duplicatesInFile++;
      continue;
    }
    seen.add(key);

    // Phones: validated, extension stripped, de-duplicated by digits. Counts
    // cover every number in the file; `stored` is what this row could write.
    const valid: { value: string; ext: boolean }[] = [];
    for (const raw of row.phones) {
      const n = normalizeComercialPhone(raw);
      if (n.invalid) report.invalidNumbers++;
      else if (!valid.some((v) => digitsOf(v.value) === digitsOf(n.value!))) valid.push({ value: n.value!, ext: n.extensionDropped });
    }
    report.extensionsDroppedInFile += valid.filter((v) => v.ext).length;
    const stored = valid.slice(0, 2);
    report.extraNumbersDropped += valid.length - stored.length;
    const [first, second] = stored;
    const storedExt = () => (report.extensionsDropped += stored.filter((v) => v.ext).length);

    const match = matchIdentity(
      { email: row.email, emailStatus: "probable", firstName: row.firstName, lastName: row.lastName, company: row.company, source: "manual_create" },
      index,
    );
    if (match.kind === "skip_own_company") {
      report.skippedOwnCompany++;
      continue;
    }
    if (match.kind === "review") continue; // unreachable: the index has no name+company keys
    const hits = byEmail.get(key) ?? [];
    if (hits.length > 1) {
      report.ambiguous++;
      continue;
    }

    if (hits.length === 1) {
      const existing = hits[0]!;
      report.matched++;
      if (row.nameInferred) report.inferredNamesOnExisting++;
      if (!first) continue;
      if (!isBlank(existing.phone) || !isBlank(existing.mobilePhone)) {
        report.skippedHasPhone++;
        continue;
      }
      fills.push({ personId: existing.id, phone: first.value, mobilePhone: second?.value ?? null });
      historyRows.push({ personId: existing.id, property: "phone", oldValue: null, newValue: first.value, changedByBdId: null, source: HISTORY_SOURCE });
      if (second) historyRows.push({ personId: existing.id, property: "mobilePhone", oldValue: null, newValue: second.value, changedByBdId: null, source: HISTORY_SOURCE });
      report.phonePersonsFilled++;
      report.phoneColumnsFilled += stored.length;
      storedExt();
      continue;
    }

    const id = genId();
    creates.push({
      id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email.trim(),
      emailNormalized: key,
      // Sheet-sourced, never verified.
      emailStatus: "probable",
      emailSource: CONTACTOS_SOURCE_KEY,
      phone: first?.value ?? null,
      mobilePhone: second?.value ?? null,
      company: row.company,
      companyKey: row.company ? resolveHotelCompanyKey(row.company, ctx.companyAliasByKey) : null,
      ownerBdId: ctx.ownerBdId,
      status: "new",
      sourceKey: CONTACTOS_SOURCE_KEY,
    });
    report.toCreate++;
    if (first) report.newWithPhone++;
    storedExt();
    if (row.nameInferred) {
      report.inferredNamesLoaded++;
      historyRows.push({ personId: id, property: NAME_INFERRED_PROPERTY, oldValue: null, newValue: "email", changedByBdId: null, source: HISTORY_SOURCE });
    }
  }
  return { creates, fills, historyRows, report };
}

const rowsRead = (rows: readonly ComercialRow[]) => rows.filter((r) => r.lastContact).length;
