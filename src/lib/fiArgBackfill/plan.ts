/**
 * Pure planner behind scripts/backfill-fi-arg-fields.ts. The 2026 fold of the
 * lead table into person never carried company text, city, country or
 * seniority; this fills them from the same drafts scripts/import-leads.ts
 * built (buildLeadDrafts), FILL-EMPTY ONLY. Never mutates its inputs.
 *
 * IDENTITY: an attendee is matched to its person the way the import linked
 * them: lead(source_key, attendee_id) -> person_id_map('lead', lead.id) ->
 * person. The DB layer and this planner share attendeeKey() for that map.
 */
import type { LeadDraft } from "@/lib/leads/csv";

export const FI_ARG_SOURCE_KEY = "fi-arg-2026";
export const FILL_FIELDS = ["company", "city", "country", "seniority"] as const;
export type FillField = (typeof FILL_FIELDS)[number];

/** The single key builder for the attendee -> person map (producer and reader both use it). */
export function attendeeKey(attendeeId: string): string {
  return attendeeId.trim();
}

export interface FiArgPerson {
  id: string;
  attendeeId: string;
  /** Not merged away and source_key is the fi-arg source: anything else is never touched. */
  inScope: boolean;
  company: string | null;
  city: string | null;
  country: string | null;
  seniority: string | null;
}

export interface FiArgFill {
  personId: string;
  property: FillField;
  value: string;
}

export interface FiArgReport {
  sourceRows: number;
  matched: number;
  unmatched: number;
  outOfScope: number;
  personsFilled: number;
  filled: Record<FillField, number>;
}

/** What the import would have written to person: company is display text, else the raw name. */
export function sourceValues(draft: LeadDraft): Record<FillField, string | null> {
  return {
    company: draft.companyDisplay ?? draft.companyRaw,
    city: draft.city,
    country: draft.country,
    seniority: draft.seniority,
  };
}

const isEmpty = (v: string | null) => !(v ?? "").trim();

export function planFiArgBackfill(drafts: readonly LeadDraft[], persons: readonly FiArgPerson[]): { fills: FiArgFill[]; report: FiArgReport } {
  const byAttendee = new Map(persons.map((p) => [attendeeKey(p.attendeeId), p]));
  // Working copy of what each person holds, so two attendees on one person cannot both fill a field.
  const state = new Map<string, Record<FillField, string | null>>();
  const fills: FiArgFill[] = [];
  const report: FiArgReport = { sourceRows: drafts.length, matched: 0, unmatched: 0, outOfScope: 0, personsFilled: 0, filled: { company: 0, city: 0, country: 0, seniority: 0 } };
  const filledPersons = new Set<string>();

  for (const draft of drafts) {
    const p = byAttendee.get(attendeeKey(draft.attendeeId));
    if (!p) {
      report.unmatched++;
      continue;
    }
    if (!p.inScope) {
      report.outOfScope++;
      continue;
    }
    report.matched++;
    const current = state.get(p.id) ?? { company: p.company, city: p.city, country: p.country, seniority: p.seniority };
    state.set(p.id, current);
    const source = sourceValues(draft);
    for (const field of FILL_FIELDS) {
      const value = source[field]?.trim();
      if (!value || !isEmpty(current[field])) continue;
      current[field] = value;
      fills.push({ personId: p.id, property: field, value });
      report.filled[field]++;
      filledPersons.add(p.id);
    }
  }
  report.personsFilled = filledPersons.size;
  return { fills, report };
}
