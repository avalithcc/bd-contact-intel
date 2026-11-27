/**
 * Lanes of `/contacts?view=outreach`. A lane is a bounded population of
 * contacts; an open IT posting is a priority signal inside the `hiring` lane,
 * not the condition to enter the view. Pure (no `@/db`), same convention as
 * ranking.ts, so the lane rules are unit-testable without a database.
 */
import type { OutreachFilters } from "@/lib/outreach/ranking";

export const OUTREACH_LANES = ["hiring", "ready_for_email"] as const;
export type OutreachLane = (typeof OUTREACH_LANES)[number];
export const DEFAULT_OUTREACH_LANE: OutreachLane = "hiring";

export function isOutreachLane(value: unknown): value is OutreachLane {
  return typeof value === "string" && (OUTREACH_LANES as readonly string[]).includes(value);
}

/** Never throws: this reads a user-controlled query param (same rule as resolveActiveView). */
export function resolveOutreachLane(param: string | string[] | undefined): OutreachLane {
  return isOutreachLane(param) ? param : DEFAULT_OUTREACH_LANE;
}

type FilterKey = keyof OutreachFilters;

/**
 * Filters each lane offers. market, miamiOnly, hideOffshore and startupsOnly
 * are derived from the hiring index, i.e. the hiring gate in disguise; in
 * `ready_for_email`, where almost no company has a posting, they would
 * silently empty the list. includeNeverMessaged is dropped there too: every
 * row of that lane is already contacted.
 */
const LANE_FILTER_KEYS: Record<OutreachLane, readonly FilterKey[]> = {
  hiring: ["roleGroup", "companyCategory", "name", "includeNeverMessaged", "market", "miamiOnly", "hideOffshore", "startupsOnly"],
  ready_for_email: ["roleGroup", "companyCategory", "name"],
};

export function laneOffersFilter(lane: OutreachLane, key: FilterKey): boolean {
  return LANE_FILTER_KEYS[lane].includes(key);
}

/** A new object holding only the filters the lane offers; never mutates `filters`. */
export function applyLaneFilters(lane: OutreachLane, filters: OutreachFilters): OutreachFilters {
  const out: Record<string, unknown> = {};
  for (const key of LANE_FILTER_KEYS[lane]) {
    if (filters[key] !== undefined) out[key] = filters[key];
  }
  return out as OutreachFilters;
}

export interface OutreachLaneSummary {
  /** Size of each lane's own population (role visibility applied, panel filters not). */
  hiring: number;
  readyForEmail: number;
  /** Where the `ready_for_email` lane's "contacted" came from; sources overlap, so they need not sum to the lane. */
  sources: { backfill: number; emailSent: number; linkedin: number };
}

export const LANE_URL = (lane: OutreachLane): string => `/contacts?view=outreach&lane=${lane}`;

/** The retired `moveToEmail` system view lives on as a lane; old links must still land somewhere useful. */
export function legacyViewRedirect(viewParam: string | undefined): string | null {
  return viewParam === "moveToEmail" ? LANE_URL("ready_for_email") : null;
}
