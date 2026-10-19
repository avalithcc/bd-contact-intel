/**
 * Pure planner behind scripts/restore-normalized-merged-phones.ts. The first
 * restore (restoreMergedPhones.ts) skipped stranded values that fail
 * `isValidPhoneFormat` (a dot-separated `+54.9.11...`), and the E.164 backfill
 * only processes live rows, so the number stayed on the merged-away row. This
 * runs those values through `normalizePhone` (explicit + only, no country inferred) and
 * hands the normalized rows to the original planner, then keeps only the
 * survivors that exist because of a normalization. Values already valid are
 * left to the original script. Pure: the input is never mutated.
 */
import { isValidPhoneFormat } from "@/lib/phone";
import { normalizePhone, type PhoneFlagReason, type PhoneRule } from "@/lib/phoneNormalize";
import { planRestoreMergedPhones, type PhoneField, type PhoneRestoreRow, type RestorePlan } from "@/lib/identity/restoreMergedPhones";

export interface NormalizableRestoreRow extends PhoneRestoreRow {
  sourceKey: string | null;
  country: string | null;
}

export interface NormalizedValue {
  mergedId: string;
  field: PhoneField;
  from: string;
  to: string;
  rule: PhoneRule;
}

export interface UnresolvedValue {
  mergedId: string;
  field: PhoneField;
  reason: PhoneFlagReason;
}

/** A stranded invalid value without an explicit `+` country code: never guessed, left for a human. */
export interface SkippedValue {
  mergedId: string;
  field: PhoneField;
}

export interface NormalizedRestorePlan {
  plan: RestorePlan;
  skipped: readonly SkippedValue[];
  normalized: readonly NormalizedValue[];
  unresolved: readonly UnresolvedValue[];
}

const SEPARATORS = /[\s().-]/g;
const FIELDS: readonly PhoneField[] = ["phone", "mobilePhone"];

export function planNormalizedMergedPhones(rows: readonly NormalizableRestoreRow[]): NormalizedRestorePlan {
  const normalized: NormalizedValue[] = [];
  const unresolved: UnresolvedValue[] = [];
  const skipped: SkippedValue[] = [];
  const prepared: PhoneRestoreRow[] = rows.map((r) => {
    const copy: PhoneRestoreRow = { id: r.id, name: r.name, ownerBdId: r.ownerBdId, phone: r.phone, mobilePhone: r.mobilePhone, mergedIntoId: r.mergedIntoId };
    if (r.mergedIntoId == null) return copy;
    for (const field of FIELDS) {
      const raw = r[field];
      if (raw == null || raw.trim() === "" || isValidPhoneFormat(raw)) continue;
      // Never guess a country: only an explicit `+` country code is read, and normalizePhone gets no source, person
      // country or provider country, so none of its Argentine or country-prefix inference can apply.
      if (!raw.replace(SEPARATORS, "").startsWith("+")) {
        skipped.push({ mergedId: r.id, field });
        continue;
      }
      const result = normalizePhone(raw, { column: field, source: null, country: null });
      if ("flagged" in result) {
        unresolved.push({ mergedId: r.id, field, reason: result.reason });
        continue;
      }
      copy[field] = result.value;
      normalized.push({ mergedId: r.id, field, from: raw, to: result.value, rule: result.rule });
    }
    return copy;
  });

  const touched = new Set(normalized.map((n) => n.mergedId));
  const full = planRestoreMergedPhones(prepared);
  const restorable = full.restorable.filter((s) => s.fills.some((f) => f.fromMergedIds.some((id) => touched.has(id))));
  const totals = new Map<string | null, { contacts: number; fills: number }>();
  for (const r of restorable) {
    const t = totals.get(r.ownerBdId) ?? { contacts: 0, fills: 0 };
    t.contacts++;
    t.fills += r.fills.length;
    totals.set(r.ownerBdId, t);
  }
  const plan: RestorePlan = {
    ...full,
    restorable,
    perBd: [...totals.entries()].map(([ownerBdId, t]) => ({ ownerBdId, ...t })),
    conflicts: full.conflicts.filter((c) => c.candidates.some((x) => touched.has(x.mergedId))),
    counts: { ...full.counts, restorableSurvivors: restorable.length },
  };
  return { plan, skipped, normalized, unresolved };
}
