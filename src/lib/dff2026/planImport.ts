/**
 * Pure planner for the Digital Finance Forum 2026 attendee import
 * (scripts/import-dff-2026.ts). No DB access — src/lib/dff2026/db.ts
 * prefetches an `ImportContext` and calls `buildImportPlan`; the DB layer
 * then turns the returned plan into the actual batched writes.
 *
 * Reuses `planHubSpotRefill` (src/lib/hubspot/refill.ts) for the "fill only
 * a currently-empty field" policy on every existing-person match — the same
 * re-import policy HubSpot's importer already uses, rather than a second
 * copy of the same rule. `ownerBdId` is passed through it too (covers
 * "unowned existing people get Mariel as owner" for free); the harder case
 * — reassigning an ALREADY-owned person to Mariel (owner reconfirmation,
 * 2026-09-30: "every contact from this file must end up owned by Mariel, no
 * exceptions") — is layered on top here, since refill.ts's fill-empty rule
 * deliberately never overwrites a non-empty field.
 *
 * Never mutates its inputs (`records`, `ctx`) — every test in
 * tests/unit/dff2026PlanImport.test.ts that calls this twice with the same
 * input asserts byte-identical output AND that the inputs are unchanged.
 */
import { randomUUID } from "node:crypto";
import type { NewPerson, NewPersonPropertyHistory } from "@/db/schema";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import type { EmailStatus } from "@/lib/identity/matcher";
import { planHubSpotRefill } from "@/lib/hubspot/refill";
import { isValidPhoneFormat, formatPhoneForDisplay } from "@/lib/phone";
import { classifyPosition } from "@/lib/roleGroups";
import type { AttendeeRecord } from "./buildAttendeeRecords";

export const DFF_2026_SOURCE_KEY = "dff-2026";
export const DFF_2026_EVENT_NAME = "Digital Finance Forum 2026";
/** New activity type (justified, per task brief): none of the existing
 * types fit "this person registered for / attended one specific event" —
 * `note` is a WORKED_ACTIVITY_TYPES entry and would wrongly count a bulk
 * historical import as "worked today"; `status_backfill` is reserved for
 * status-cache reconstructions and carries `metadata.status` semantics this
 * import has no use for. Excluded from `NON_TOUCH_ACTIVITY_TYPES`
 * (src/lib/contacts/effectiveActivityTime.ts) so it never makes 738+
 * contacts look "active today" in the last-activity column/sort/filter, and
 * — by simply never being added to it — already excluded from
 * `WORKED_ACTIVITY_TYPES` (src/lib/followUp/queueSelection.ts) and from
 * status derivation (src/lib/status/deriveStatus.ts only recognizes types
 * it explicitly lists; an unrecognized type contributes no stage/discard). */
export const DFF_2026_ATTENDANCE_ACTIVITY_TYPE = "event_attendance";

export type ImportScope = "all" | "attended";

type HistoryRow = Omit<NewPersonPropertyHistory, "id" | "at">;

export interface ExistingPersonForImport {
  id: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  mobilePhone: string | null;
  company: string | null;
  companyKey: string | null;
  ownerBdId: string | null;
  email: string | null;
  emailNormalized: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number | null;
  emailSource: string | null;
}

export interface ExistingCompanyForImport {
  companyKey: string;
  displayName: string;
}

export interface ImportContext {
  marielBdId: string;
  bdNamesById: ReadonlyMap<string, string>;
  /** Keyed by `person.email_normalized`, non-merged persons only. */
  existingPersonsByEmail: ReadonlyMap<string, ExistingPersonForImport>;
  /** `company_alias.alias_key` -> canonical `company_key`. */
  companyAliasByKey: ReadonlyMap<string, string>;
  existingCompaniesByKey: ReadonlyMap<string, ExistingCompanyForImport>;
  /** person ids that already have an `event_attendance` row for this
   * source_key — re-running the import must not duplicate it. */
  existingAttendancePersonIds: ReadonlySet<string>;
}

export interface ExistingPersonUpdatePlan {
  personId: string;
  personUpdate: Partial<NewPerson>;
  historyRows: HistoryRow[];
  /** Non-null only when this person's owner was a DIFFERENT, real BD
   * (the "taken from another BD" case the owner asked to be counted and
   * named separately from a plain unowned -> Mariel fill). */
  reassignedFromBdId: string | null;
  reassignedFromName: string | null;
}

export interface CompanyToCreate {
  companyKey: string;
  displayName: string;
}

export interface PhoneRejection {
  email: string;
  raw: string;
  reason: "invalid_chars" | "misplaced_plus" | "too_few_digits" | "unknown";
}

export interface SampleRow {
  isNew: boolean;
  firstName: string | null;
  lastName: string | null;
  email: string;
  company: string | null;
  jobTitle: string | null;
  attended: boolean;
}

export interface ImportReport {
  rowsInScope: number;
  rowsExcludedByScope: number;
  created: number;
  existingMatched: number;
  existingNewlyOwned: number;
  existingReassignedFromOtherBd: { personId: string; previousOwnerName: string }[];
  companiesMatched: number;
  companiesCreated: number;
  roleGroupDistribution: Record<string, number>;
  phonesWritten: number;
  phonesRejected: PhoneRejection[];
  phoneDigitLengthHistogram: Record<number, number>;
  attendanceToRecord: number;
  attendanceAlreadyRecorded: number;
  sample: SampleRow[];
}

export interface DffImportPlan {
  creates: NewPerson[];
  updates: ExistingPersonUpdatePlan[];
  companiesToCreate: CompanyToCreate[];
  attendance: { personId: string }[];
  report: ImportReport;
}

const SAMPLE_SIZE = 20;
const PHONE_CHARS_RE = /^\+?[0-9 ()-]+$/;

function countDigits(v: string): number {
  return (v.match(/[0-9]/g) ?? []).length;
}

function explainPhoneRejection(raw: string): PhoneRejection["reason"] {
  if (!PHONE_CHARS_RE.test(raw)) return "invalid_chars";
  if (raw.indexOf("+") > 0) return "misplaced_plus";
  if (countDigits(raw) < 6) return "too_few_digits";
  return "unknown";
}

/** Validates + records phone stats; never reformats a value that passes
 * (owner decision 2026-09-30: store raw, trimmed/control-stripped only —
 * no +54 prefixing, since a mobile can't be told apart from a landline by
 * digit count alone and the rewrite would not be reversible). */
function resolvePhone(raw: string | null, email: string, report: ImportReport): string | null {
  if (!raw) return null;
  const digitLength = countDigits(raw);
  report.phoneDigitLengthHistogram[digitLength] = (report.phoneDigitLengthHistogram[digitLength] ?? 0) + 1;
  if (!isValidPhoneFormat(raw)) {
    report.phonesRejected.push({ email, raw, reason: explainPhoneRejection(raw) });
    return null;
  }
  report.phonesWritten++;
  return formatPhoneForDisplay(raw);
}

/** Resolves EMPRESA to a `company_key` the same way src/lib/queries.ts's
 * `companyKeyFilter` reads it on the way out: normalize, then resolve
 * through `company_alias` to a canonical key before ever looking at
 * `company` — so a raw name that's an alias of an already-tracked company
 * links to that ONE row instead of creating a near-duplicate. */
function resolveCompanyKey(
  raw: string,
  ctx: ImportContext,
  companiesToCreate: Map<string, CompanyToCreate>,
  matchedCompanyKeys: Set<string>,
): string {
  const rawKey = normalizeCompanyKey(raw);
  const canonicalKey = ctx.companyAliasByKey.get(rawKey) ?? rawKey;
  const existing = ctx.existingCompaniesByKey.get(canonicalKey);
  if (existing) {
    matchedCompanyKeys.add(existing.companyKey);
    return existing.companyKey;
  }
  if (!companiesToCreate.has(canonicalKey)) {
    companiesToCreate.set(canonicalKey, { companyKey: canonicalKey, displayName: raw });
  }
  return canonicalKey;
}

function buildNewPerson(
  record: AttendeeRecord,
  personId: string,
  ctx: ImportContext,
  companiesToCreate: Map<string, CompanyToCreate>,
  matchedCompanyKeys: Set<string>,
  report: ImportReport,
): NewPerson {
  const companyKey = record.companyRaw ? resolveCompanyKey(record.companyRaw, ctx, companiesToCreate, matchedCompanyKeys) : null;
  const mobilePhone = resolvePhone(record.mobilePhoneRaw, record.email, report);
  return {
    id: personId,
    firstName: record.firstName,
    lastName: record.lastName,
    email: record.email,
    emailNormalized: record.emailNormalized,
    emailStatus: "probable", // self-registered event email — never "verified"
    emailSource: DFF_2026_SOURCE_KEY,
    mobilePhone,
    company: record.companyRaw,
    companyKey,
    jobTitle: record.jobTitle,
    roleGroup: classifyPosition(record.jobTitle),
    ownerBdId: ctx.marielBdId,
    status: "new",
    sourceKey: DFF_2026_SOURCE_KEY,
  };
}

const UNSUPPORTED_REFILL_KEYS = ["email", "emailNormalized", "emailStatus", "emailConfidence", "emailSource"] as const;

function buildExistingUpdate(
  record: AttendeeRecord,
  existing: ExistingPersonForImport,
  ctx: ImportContext,
  companiesToCreate: Map<string, CompanyToCreate>,
  matchedCompanyKeys: Set<string>,
  report: ImportReport,
): ExistingPersonUpdatePlan {
  const mobilePhone = resolvePhone(record.mobilePhoneRaw, record.email, report);
  const companyKey = record.companyRaw ? resolveCompanyKey(record.companyRaw, ctx, companiesToCreate, matchedCompanyKeys) : null;

  const refill = planHubSpotRefill(
    { ...existing, industry: null, city: null, country: null },
    {
      firstName: record.firstName,
      lastName: record.lastName,
      company: record.companyRaw,
      companyKey,
      jobTitle: record.jobTitle,
      industry: null,
      city: null,
      country: null,
      // Fills "unowned -> Mariel" for free via refill's own fill-empty rule.
      ownerBdId: ctx.marielBdId,
      // A row matched BY email_normalized always has a non-empty email
      // already — this branch of refill.ts can never legitimately fire.
      email: null,
      emailStatus: "none",
      emailConfidence: null,
      emailSource: null,
    },
  );
  for (const key of UNSUPPORTED_REFILL_KEYS) {
    if (refill.personUpdate && key in refill.personUpdate) {
      throw new Error(`dff-2026 import: unexpected '${key}' fill for person ${existing.id} — matched-by-email persons must already have a non-empty email.`);
    }
  }

  const personUpdate: Partial<NewPerson> = refill.personUpdate ? { ...refill.personUpdate } : {};
  const historyRows: HistoryRow[] = [...refill.historyRows];

  // roleGroup has no independent source data — always re-derived from the
  // FINAL jobTitle when jobTitle was just filled (same rule
  // src/lib/identity/resolve.ts's rowAsMerged already follows).
  if (personUpdate.jobTitle !== undefined) {
    personUpdate.roleGroup = classifyPosition(personUpdate.jobTitle as string | null);
  }

  // mobilePhone: refill.ts has no concept of this column — same fill-empty
  // rule, applied by hand for the one extra field.
  if (!existing.mobilePhone && mobilePhone) {
    personUpdate.mobilePhone = mobilePhone;
    historyRows.push({ personId: existing.id, property: "mobilePhone", oldValue: existing.mobilePhone, newValue: mobilePhone, changedByBdId: null, source: "import" });
  }

  // Owner reconfirmation (2026-09-30): reassigning FROM a different, real BD
  // is a deliberate override beyond fill-empty — refill.ts's fillField only
  // ever fills a field that's currently empty.
  let reassignedFromBdId: string | null = null;
  let reassignedFromName: string | null = null;
  if (existing.ownerBdId && existing.ownerBdId !== ctx.marielBdId) {
    personUpdate.ownerBdId = ctx.marielBdId;
    historyRows.push({ personId: existing.id, property: "ownerBdId", oldValue: existing.ownerBdId, newValue: ctx.marielBdId, changedByBdId: null, source: "import" });
    reassignedFromBdId = existing.ownerBdId;
    reassignedFromName = ctx.bdNamesById.get(existing.ownerBdId) ?? existing.ownerBdId;
  }

  if (Object.keys(personUpdate).length > 0) personUpdate.updatedAt = new Date();

  return { personId: existing.id, personUpdate, historyRows, reassignedFromBdId, reassignedFromName };
}

function emptyReport(): ImportReport {
  return {
    rowsInScope: 0,
    rowsExcludedByScope: 0,
    created: 0,
    existingMatched: 0,
    existingNewlyOwned: 0,
    existingReassignedFromOtherBd: [],
    companiesMatched: 0,
    companiesCreated: 0,
    roleGroupDistribution: {},
    phonesWritten: 0,
    phonesRejected: [],
    phoneDigitLengthHistogram: {},
    attendanceToRecord: 0,
    attendanceAlreadyRecorded: 0,
    sample: [],
  };
}

export function buildImportPlan(
  records: readonly AttendeeRecord[],
  scope: ImportScope,
  ctx: ImportContext,
  genId: () => string = randomUUID,
): DffImportPlan {
  const inScope = scope === "attended" ? records.filter((r) => r.attended) : records;
  const companiesToCreate = new Map<string, CompanyToCreate>();
  const matchedCompanyKeys = new Set<string>();
  const report = emptyReport();
  report.rowsInScope = inScope.length;
  report.rowsExcludedByScope = records.length - inScope.length;

  const creates: NewPerson[] = [];
  const updates: ExistingPersonUpdatePlan[] = [];
  const attendance: { personId: string }[] = [];

  for (const record of inScope) {
    const existing = ctx.existingPersonsByEmail.get(record.emailNormalized);
    const effectiveJobTitle = existing ? existing.jobTitle || record.jobTitle : record.jobTitle;
    const roleGroup = classifyPosition(effectiveJobTitle);
    report.roleGroupDistribution[roleGroup] = (report.roleGroupDistribution[roleGroup] ?? 0) + 1;

    let personId: string;
    if (existing) {
      const update = buildExistingUpdate(record, existing, ctx, companiesToCreate, matchedCompanyKeys, report);
      updates.push(update);
      personId = existing.id;
      if (update.reassignedFromBdId) {
        report.existingReassignedFromOtherBd.push({ personId: existing.id, previousOwnerName: update.reassignedFromName! });
      } else if (!existing.ownerBdId) {
        report.existingNewlyOwned++;
      }
    } else {
      personId = genId();
      creates.push(buildNewPerson(record, personId, ctx, companiesToCreate, matchedCompanyKeys, report));
    }

    if (record.attended) {
      if (ctx.existingAttendancePersonIds.has(personId)) report.attendanceAlreadyRecorded++;
      else attendance.push({ personId });
    }

    if (report.sample.length < SAMPLE_SIZE) {
      report.sample.push({
        isNew: !existing,
        firstName: record.firstName,
        lastName: record.lastName,
        email: record.email,
        company: record.companyRaw,
        jobTitle: effectiveJobTitle,
        attended: record.attended,
      });
    }
  }

  report.created = creates.length;
  report.existingMatched = updates.length;
  report.attendanceToRecord = attendance.length;
  report.companiesMatched = matchedCompanyKeys.size;
  report.companiesCreated = companiesToCreate.size;

  return { creates, updates, companiesToCreate: [...companiesToCreate.values()], attendance, report };
}

// --- Revert audit-row selection (pure; src/lib/dff2026/db.ts wires it) -----

export interface DffAuditMetadata {
  sourceKey: string;
  scope: ImportScope;
  createdPersonIds: string[];
  updatedHistoryRows: HistoryRow[];
  companiesCreated: string[];
  attendanceActivityIds: string[];
}

export interface DffAuditRow {
  id: string;
  at: Date;
  actorBdId: string;
  metadata: DffAuditMetadata;
}

export type DffAuditSelection =
  | { kind: "none" }
  | { kind: "selected"; row: DffAuditRow }
  | { kind: "not_found"; requestedAuditId: string; candidates: DffAuditRow[] }
  | { kind: "ambiguous"; candidates: DffAuditRow[] };

/** Never just picks "the latest" row: more than one non-empty run with no
 * `--audit-id` given refuses and lists every candidate (same safety rule as
 * src/lib/identity/stuffedNameSplitBackfillRevert.ts#selectStuffedNameSplitAuditRow). */
export function selectDffAuditRow(rows: readonly DffAuditRow[], auditId: string | null): DffAuditSelection {
  if (auditId) {
    const match = rows.find((r) => r.id === auditId);
    return match ? { kind: "selected", row: match } : { kind: "not_found", requestedAuditId: auditId, candidates: [...rows] };
  }
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "selected", row: rows[0]! };
  return { kind: "ambiguous", candidates: [...rows] };
}
