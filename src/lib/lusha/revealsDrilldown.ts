// The pure half of the "Revelados" drill-down on /admin/lusha: how the raw rows of getRevealsDrilldown (adminDb.ts) become
// typed rows. No DB here. Raw `sql` rows arrive with strings for timestamps and integers.

import { parseDbTimestamp } from "@/lib/db/timestamp";

/** One row of the drill-down query, exactly as postgres-js returns it. */
export interface RevealDrilldownRawRow {
  rd_reveal_id: string;
  rd_person_id: string;
  /** Empty string when the person has neither first nor last name. */
  rd_person_name: string;
  rd_company: string | null;
  rd_field: "emails" | "phones";
  rd_value: string | null;
  rd_actor_bd_id: string;
  rd_actor_bd_name: string;
  rd_at: Date | string;
  rd_credits_charged: number | string | null;
}

export interface RevealDrilldownRow {
  revealId: string;
  personId: string;
  /** Empty when the contact has no name; the caller renders the repo's "unnamed" label. */
  personName: string;
  company: string | null;
  field: "emails" | "phones";
  value: string | null;
  actorBdId: string;
  actorBdName: string;
  at: Date;
  /** null = the reveal succeeded but Lusha has not confirmed the charge yet. Never coerced to 0. */
  creditsCharged: number | null;
}

export function mapRevealDrilldownRow(r: RevealDrilldownRawRow): RevealDrilldownRow {
  return {
    revealId: r.rd_reveal_id,
    personId: r.rd_person_id,
    personName: r.rd_person_name,
    company: r.rd_company,
    field: r.rd_field,
    value: r.rd_value,
    actorBdId: r.rd_actor_bd_id,
    actorBdName: r.rd_actor_bd_name,
    at: parseDbTimestamp(r.rd_at),
    creditsCharged: r.rd_credits_charged === null ? null : Number(r.rd_credits_charged),
  };
}

export const buildRevealDrilldownRows = (rows: readonly RevealDrilldownRawRow[]): RevealDrilldownRow[] => rows.map(mapRevealDrilldownRow);
