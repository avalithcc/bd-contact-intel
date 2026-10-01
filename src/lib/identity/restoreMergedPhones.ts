/**
 * Pure planner behind scripts/restore-merged-phones.ts. Before
 * fix/merge-carries-phone, a merge never copied `person.phone` /
 * `person.mobile_phone` onto the survivor, stranding the number on the
 * merged-away row. This plans the recovery; no DB access here.
 *
 * Rules:
 * - Only a survivor with BOTH phone and mobile blank is touched, and only a
 *   blank is ever filled (the write also guards on blank in SQL).
 * - Every merged-away row that resolves to the survivor (directly or through
 *   a chain of merges) contributes. Two numbers that share the same digits
 *   agree (formatting differs); numbers with different digits CONFLICT: the
 *   whole survivor is skipped and reported for a human, never picked.
 * - A value failing `isValidPhoneFormat` is reported and never written.
 * - Pure: the input is never mutated.
 */
import { formatPhoneForDisplay, isValidPhoneFormat } from "@/lib/phone";

export type PhoneField = "phone" | "mobilePhone";
const PHONE_FIELDS: readonly PhoneField[] = ["phone", "mobilePhone"];
const MAX_CHAIN_DEPTH = 20;

export interface PhoneRestoreRow {
  id: string;
  name: string;
  ownerBdId: string | null;
  phone: string | null;
  mobilePhone: string | null;
  mergedIntoId: string | null;
}

export interface PhoneFill {
  field: PhoneField;
  value: string;
  fromMergedIds: readonly string[];
}

export interface RestorableSurvivor {
  survivorId: string;
  name: string;
  ownerBdId: string | null;
  fills: readonly PhoneFill[];
}

export interface PhoneConflict {
  survivorId: string;
  name: string;
  ownerBdId: string | null;
  field: PhoneField;
  candidates: readonly { mergedId: string; value: string }[];
}

export interface InvalidPhone {
  survivorId: string;
  mergedId: string;
  field: PhoneField;
  value: string;
}

export interface RestorePlan {
  restorable: readonly RestorableSurvivor[];
  conflicts: readonly PhoneConflict[];
  invalid: readonly InvalidPhone[];
  perBd: readonly { ownerBdId: string | null; contacts: number; fills: number }[];
  counts: {
    mergedRows: number;
    survivorsConsidered: number;
    survivorsAlreadyHavePhone: number;
    unresolvedMergedRows: number;
    restorableSurvivors: number;
    conflictSurvivors: number;
    invalidValues: number;
  };
}

function isBlank(v: string | null): boolean {
  return v == null || v.trim() === "";
}

/** Two phones are the same number when their digits match, whatever the formatting. */
function digitsKey(v: string): string {
  return v.replace(/[^0-9]/g, "");
}

function compareId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Walks `mergedIntoId` to the row that was never merged away; null when the chain is broken or cyclic. */
function resolveRoot(start: PhoneRestoreRow, byId: ReadonlyMap<string, PhoneRestoreRow>): PhoneRestoreRow | null {
  const seen = new Set<string>([start.id]);
  let current = start;
  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    if (current.mergedIntoId == null) return current;
    const next = byId.get(current.mergedIntoId);
    if (!next || seen.has(next.id)) return null;
    seen.add(next.id);
    current = next;
  }
  return null;
}

export function planRestoreMergedPhones(rows: readonly PhoneRestoreRow[]): RestorePlan {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const mergedRows = rows.filter((r) => r.mergedIntoId != null).sort(compareId);

  const descendantsByRoot = new Map<string, PhoneRestoreRow[]>();
  let unresolvedMergedRows = 0;
  for (const m of mergedRows) {
    const root = resolveRoot(m, byId);
    if (!root) {
      unresolvedMergedRows++;
      continue;
    }
    const list = descendantsByRoot.get(root.id) ?? [];
    list.push(m);
    descendantsByRoot.set(root.id, list);
  }

  const restorable: RestorableSurvivor[] = [];
  const conflicts: PhoneConflict[] = [];
  const invalid: InvalidPhone[] = [];
  let survivorsAlreadyHavePhone = 0;
  let conflictSurvivors = 0;

  const roots = [...descendantsByRoot.keys()].map((id) => byId.get(id)!).sort(compareId);
  for (const survivor of roots) {
    if (!isBlank(survivor.phone) || !isBlank(survivor.mobilePhone)) {
      survivorsAlreadyHavePhone++;
      continue;
    }
    const fills: PhoneFill[] = [];
    const survivorConflicts: PhoneConflict[] = [];
    for (const field of PHONE_FIELDS) {
      const groups = new Map<string, { value: string; mergedIds: string[] }>();
      for (const m of descendantsByRoot.get(survivor.id)!) {
        const raw = m[field];
        if (raw == null || isBlank(raw)) continue;
        if (!isValidPhoneFormat(raw)) {
          invalid.push({ survivorId: survivor.id, mergedId: m.id, field, value: raw });
          continue;
        }
        const key = digitsKey(raw);
        const group = groups.get(key);
        if (group) group.mergedIds.push(m.id);
        else groups.set(key, { value: formatPhoneForDisplay(raw), mergedIds: [m.id] });
      }
      const distinct = [...groups.values()];
      if (distinct.length === 1) {
        fills.push({ field, value: distinct[0]!.value, fromMergedIds: distinct[0]!.mergedIds });
      } else if (distinct.length > 1) {
        survivorConflicts.push({
          survivorId: survivor.id,
          name: survivor.name,
          ownerBdId: survivor.ownerBdId,
          field,
          candidates: distinct.flatMap((g) => g.mergedIds.map((mergedId) => ({ mergedId, value: g.value }))),
        });
      }
    }
    if (survivorConflicts.length > 0) {
      conflictSurvivors++;
      conflicts.push(...survivorConflicts);
    } else if (fills.length > 0) {
      restorable.push({ survivorId: survivor.id, name: survivor.name, ownerBdId: survivor.ownerBdId, fills });
    }
  }

  const bdTotals = new Map<string | null, { contacts: number; fills: number }>();
  for (const r of restorable) {
    const t = bdTotals.get(r.ownerBdId) ?? { contacts: 0, fills: 0 };
    t.contacts++;
    t.fills += r.fills.length;
    bdTotals.set(r.ownerBdId, t);
  }
  const perBd = [...bdTotals.entries()]
    .map(([ownerBdId, t]) => ({ ownerBdId, ...t }))
    .sort((a, b) => (a.ownerBdId === b.ownerBdId ? 0 : a.ownerBdId === null ? 1 : b.ownerBdId === null ? -1 : a.ownerBdId < b.ownerBdId ? -1 : 1));

  return {
    restorable,
    conflicts,
    invalid,
    perBd,
    counts: {
      mergedRows: mergedRows.length,
      survivorsConsidered: roots.length,
      survivorsAlreadyHavePhone,
      unresolvedMergedRows,
      restorableSurvivors: restorable.length,
      conflictSurvivors,
      invalidValues: invalid.length,
    },
  };
}

/** The dry-run report the owner checks line by line before approving `--execute`. */
export function formatRestoreReport(plan: RestorePlan, ownerNameById: ReadonlyMap<string, string>): string[] {
  const ownerName = (id: string | null) => (id ? (ownerNameById.get(id) ?? id) : "(no owner)");
  const c = plan.counts;
  const lines: string[] = [
    `Merged-away rows read: ${c.mergedRows}`,
    `Survivors with merged rows: ${c.survivorsConsidered}`,
    `  already have a phone or mobile (untouched): ${c.survivorsAlreadyHavePhone}`,
    `  unresolved merged rows (broken or cyclic chain): ${c.unresolvedMergedRows}`,
    `Would restore: ${c.restorableSurvivors} contact(s)`,
    `Skipped for a human (merged rows disagree): ${c.conflictSurvivors}`,
    `Invalid stranded values (reported, never written): ${c.invalidValues}`,
    "",
    "Per contact (survivor [owner] <- merged row):",
  ];
  for (const r of plan.restorable) {
    for (const f of r.fills) {
      lines.push(`  ${r.name} (${r.survivorId}) [${ownerName(r.ownerBdId)}]: ${f.field} <- ${f.value} from ${f.fromMergedIds.join(", ")}`);
    }
  }
  if (plan.conflicts.length) {
    lines.push("", "Conflicts (SKIPPED, left for a human):");
    for (const k of plan.conflicts) {
      lines.push(`  ${k.name} (${k.survivorId}) [${ownerName(k.ownerBdId)}] ${k.field}: ${k.candidates.map((x) => `${x.value} (${x.mergedId})`).join(" vs ")}`);
    }
  }
  if (plan.invalid.length) {
    lines.push("", "Invalid values (SKIPPED):");
    for (const i of plan.invalid) lines.push(`  survivor ${i.survivorId}, merged ${i.mergedId}, ${i.field}: "${i.value}"`);
  }
  lines.push("", "Per BD:");
  for (const b of plan.perBd) lines.push(`  ${ownerName(b.ownerBdId)}: ${b.contacts} contact(s), ${b.fills} fill(s)`);
  return lines;
}
